import type { IikoEmployeeRecord, SalaryOnDate } from '#root/types/iiko-salary.js'
import type { Response } from 'undici'
import { createHash, randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { Agent, fetch } from 'undici'

export interface IikoServerClientConfig {
  baseUrl: string
  login: string
  /** Пароль в открытом виде: для auth передаётся SHA-1 hex, как в типичной схеме iikoServer. */
  password: string
  timeoutMs: number
  maxRetries: number
  retryBaseMs: number
  /** Не проверять TLS (только dev / самоподписанный серт на LAN). */
  tlsInsecure: boolean
  /** Путь к PEM CA — если задан, используется вместо insecure. */
  tlsCaPath: string
}

export interface IikoServerApi {
  getEmployees: () => Promise<IikoEmployeeRecord[]>
  getEmployeeSalaryOnDate: (employeeId: string, date: string) => Promise<SalaryOnDate | null>
}

/**
 * iikoServer Resto API: `GET /resto/api/auth` → `key`, `?key=` на остальных запросах, `GET /resto/api/logout`.
 * @see iiko help «Getting started» / `resto/api`
 */
export class IikoServerClient {
  private readonly restoApi: string
  private readonly dispatcher: Agent | undefined
  private readonly httpPassHash: string

  constructor(readonly config: IikoServerClientConfig) {
    this.restoApi = `${config.baseUrl.replace(/\/+$/u, '')}/resto/api`
    this.httpPassHash = createHash('sha1').update(config.password, 'utf8').digest('hex')
    if (config.tlsCaPath.trim()) {
      const ca = readFileSync(config.tlsCaPath.trim())
      this.dispatcher = new Agent({ connect: { ca, rejectUnauthorized: true } })
    }
    else if (config.tlsInsecure) {
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
    }
  }

  withSession: <T>(work: (api: IikoServerApi) => Promise<T>) => Promise<T> = async (work) => {
    const keyRef = { value: await this.login() }
    try {
      const api: IikoServerApi = {
        getEmployees: () => this.getEmployeesKey(keyRef),
        getEmployeeSalaryOnDate: (id, d) => this.getEmployeeSalaryOnDateKey(keyRef, id, d),
      }
      return await work(api)
    }
    finally {
      await this.logout(keyRef.value).catch(() => undefined)
    }
  }

  async login(): Promise<string> {
    const url = `${this.restoApi}/auth?${new URLSearchParams({
      login: this.config.login,
      pass: this.httpPassHash,
    })}`
    const res = await this.withRetries(
      () => this.fetchWithTimeout(url, { Accept: 'text/plain' }),
      { retry5xx: true },
    )
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`iikoServer auth failed: ${res.status} ${t}`.trim())
    }
    const key = (await res.text()).trim()
    if (!key) {
      throw new Error('iikoServer auth: empty key')
    }
    return key
  }

  async logout(key: string): Promise<void> {
    if (!key)
      return
    const url = `${this.restoApi}/logout?${new URLSearchParams({ key })}`
    const res = await this.fetchWithTimeout(url).catch(() => null)
    if (res && !res.ok)
      await res.text().catch(() => undefined)
  }

  private async getEmployeesKey(keyRef: { value: string }): Promise<IikoEmployeeRecord[]> {
    const { response, text } = await this.getJson(
      keyRef,
      key => `${this.restoApi}/employees?${new URLSearchParams({ key })}`,
      { notJsonOk: [404, 204] },
    )
    if (response.status === 404 || response.status === 204)
      return []
    if (!response.ok) {
      throw new Error(`iikoServer getEmployees: ${response.status} ${text}`.trim())
    }
    if (!text || text.trim() === '' || text.trim() === 'null') {
      return []
    }
    if (text.trim().startsWith('<')) {
      throw new Error('iikoServer getEmployees: expected JSON, got XML (check headers).')
    }
    const data = JSON.parse(text) as unknown
    if (Array.isArray(data)) {
      return (data as IikoEmployeeRecord[]).filter(
        (e): e is IikoEmployeeRecord =>
          typeof e === 'object' && e !== null && 'id' in e && String((e as IikoEmployeeRecord).id) !== '',
      )
    }
    if (typeof data === 'object' && data !== null && 'employees' in data) {
      const em = (data as { employees: IikoEmployeeRecord[] }).employees
      if (Array.isArray(em)) {
        return em.filter(
          e => e && String(e.id) !== '',
        )
      }
    }
    return []
  }

  private async getEmployeeSalaryOnDateKey(
    keyRef: { value: string },
    employeeId: string,
    ymd: string,
  ): Promise<SalaryOnDate | null> {
    const id = encodeURIComponent(employeeId)
    const { response, text } = await this.getJson(
      keyRef,
      key => `${this.restoApi}/employees/salary/byId/${id}/${ymd}?${new URLSearchParams({ key })}`,
      { notJsonOk: [404, 400, 204] },
    )
    if (response.status === 404 || response.status === 204)
      return null
    if (!text || text.trim() === '' || text.trim() === 'null')
      return null
    if (response.status === 400) {
      return null
    }
    if (!response.ok) {
      throw new Error(`iikoServer salary: ${response.status} ${text}`.trim())
    }
    if (text.trim().startsWith('<')) {
      throw new Error('iikoServer salary: expected JSON, got XML')
    }
    return JSON.parse(text) as SalaryOnDate
  }

  private async getJson(
    keyRef: { value: string },
    buildUrl: (key: string) => string,
    opts?: { notJsonOk?: number[] },
  ): Promise<{ response: Response, text: string }> {
    const load = async (afterReauth: boolean) => {
      if (afterReauth) {
        const old = keyRef.value
        if (old) {
          await this.logout(old).catch(() => undefined)
        }
        keyRef.value = await this.login()
      }
      const u = buildUrl(keyRef.value)
      return this.withRetries(
        () => this.fetchWithTimeout(u, { Accept: 'application/json' }),
        { retry5xx: true },
      )
    }
    let res = await load(false)
    if (res.status === 401) {
      res = await load(true)
    }
    if (res.status === 401) {
      throw new Error('iikoServer: unauthorized after re-login (check credentials/rights).')
    }
    const notJsonOk = opts?.notJsonOk ?? []
    if (notJsonOk.includes(res.status)) {
      return { response: res, text: await res.text() }
    }
    const text = await res.text()
    return { response: res, text }
  }

  private async withRetries(
    doFetch: () => Promise<Response>,
    opts: { retry5xx: boolean } = { retry5xx: false },
  ) {
    const max = this.config.maxRetries
    let lastErr: unknown
    for (let a = 0; a <= max; a++) {
      try {
        const res = await doFetch()
        if (res.status < 500 || !opts.retry5xx) {
          return res
        }
        if (a === max)
          return res
        await sleep((this.config.retryBaseMs * 2 ** a) + randomInt(0, 200))
        continue
      }
      catch (e) {
        lastErr = e
        if (a === max)
          break
        await sleep((this.config.retryBaseMs * 2 ** a) + randomInt(0, 200))
      }
    }
    throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr)))
  }

  private async fetchWithTimeout(
    input: string | URL,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), this.config.timeoutMs)
    try {
      return await fetch(input, {
        method: 'GET',
        headers,
        signal: c.signal,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      })
    }
    finally {
      clearTimeout(t)
    }
  }
}

export function createIikoServerClient(c: IikoServerClientConfig): IikoServerClient {
  return new IikoServerClient(c)
}
