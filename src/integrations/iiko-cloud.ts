import type { Logger } from 'pino'

/** Конфиг клиента. baseUrl обычно 'https://api-ru.iiko.services'. */
export interface IikoCloudClientOptions {
  baseUrl: string
  apiLogin: string
  logger?: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>
  /** Для тестов можно подменить глобальный fetch. */
  fetchImpl?: typeof fetch
  /** Таймаут одного запроса, мс. По умолчанию 30000. */
  requestTimeoutMs?: number
  /** Сколько токен считаем валидным (iiko даёт ~1ч, берём с запасом). */
  tokenTtlMs?: number
}

export interface IikoOlapReportRequest {
  organizationIds: string[]
  reportType: 'SALES' | 'TRANSACTIONS' | 'DELIVERIES' | string
  buildSummary?: boolean
  groupByRowFields: string[]
  groupByColFields?: string[]
  aggregateFields: string[]
  filters?: Record<string, unknown>
}

export interface IikoOlapReportResponse {
  data: Array<Record<string, unknown>>
  summary?: Record<string, unknown>
}

export class IikoCloudError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'IikoCloudError'
  }
}

export function createIikoCloudClient(opts: IikoCloudClientOptions) {
  const {
    baseUrl,
    apiLogin,
    logger,
    fetchImpl = fetch,
    requestTimeoutMs = 30_000,
    tokenTtlMs = 50 * 60_000,
  } = opts

  let cachedToken: string | null = null
  let cachedUntil = 0

  async function fetchAccessToken(): Promise<string> {
    const url = `${baseUrl}/api/1/access_token`
    const res = await timedFetch(fetchImpl, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiLogin }),
    }, requestTimeoutMs)

    const text = await res.text()
    if (!res.ok) {
      throw new IikoCloudError(
        `access_token failed: ${res.status}`,
        res.status,
        safeJson(text),
      )
    }
    const parsed = safeJson(text) as { token?: string } | undefined
    const token = parsed?.token
    if (!token || typeof token !== 'string')
      throw new IikoCloudError('access_token: no token in response', res.status, parsed)
    return token
  }

  async function getToken(force = false): Promise<string> {
    const now = Date.now()
    if (!force && cachedToken && now < cachedUntil)
      return cachedToken
    const token = await fetchAccessToken()
    cachedToken = token
    cachedUntil = Date.now() + tokenTtlMs
    logger?.debug({ scope: 'iiko' }, 'token refreshed')
    return token
  }

  async function authorizedPost<T>(path: string, body: unknown): Promise<T> {
    const doRequest = async (token: string) => {
      const res = await timedFetch(fetchImpl, `${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Timeout': '60',
        },
        body: JSON.stringify(body),
      }, requestTimeoutMs)
      const text = await res.text()
      const parsed = safeJson(text)
      if (!res.ok) {
        throw new IikoCloudError(
          `iiko ${path} failed: ${res.status}`,
          res.status,
          parsed,
        )
      }
      return parsed as T
    }

    let token = await getToken()
    try {
      return await doRequest(token)
    }
    catch (err) {
      if (err instanceof IikoCloudError && err.status === 401) {
        logger?.warn({ scope: 'iiko', path }, '401, refresh token and retry once')
        token = await getToken(true)
        return await doRequest(token)
      }
      throw err
    }
  }

  async function getOlapReport(req: IikoOlapReportRequest): Promise<IikoOlapReportResponse> {
    return authorizedPost<IikoOlapReportResponse>('/api/1/reports/olap', req)
  }

  return {
    getOlapReport,
    getToken,
  }
}

function timedFetch(
  f: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
  return f(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

function safeJson(text: string): unknown {
  if (!text)
    return undefined
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}
