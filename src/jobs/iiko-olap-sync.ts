import type { Config } from '#root/config.js'
import type { IikoOlapReportRequest, IikoOlapReportResponse } from '#root/integrations/iiko-cloud.js'
import type { SheetsRepo } from '#root/repos/sheets-repo.js'
import type { Logger } from 'pino'
import { writeIikoOlapReport } from '#root/bot/helpers/iiko-olap-sheet.js'
import { createIikoCloudClient } from '#root/integrations/iiko-cloud.js'

export interface IikoOlapSyncDeps {
  config: Config
  sheetsRepo: SheetsRepo
  logger: Logger
}

export interface IikoOlapSyncResult {
  /** true — сделали, false — пропустили по конфигу. */
  executed: boolean
  rowsWritten: number
  durationMs: number
  periodFrom: string
  periodTo: string
  /** На всякий случай поднять наверх, чтобы UI-команды могли показать ошибку. */
  error?: unknown
}

// iiko ожидает 'yyyy-MM-dd HH:mm:ss' без таймзоны.

/** Собираем вчерашний день в таймзоне из конфига, возвращаем строки для iiko. */
function computePreviousDayPeriod(timezone: string): { from: string, to: string } {
  const now = new Date()
  // Берём компоненты "сейчас" в нужной таймзоне без внешних библиотек.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = Number(parts.find(p => p.type === 'year')!.value)
  const m = Number(parts.find(p => p.type === 'month')!.value)
  const d = Number(parts.find(p => p.type === 'day')!.value)
  // Вчерашняя дата (локально в timezone; переносит месяц/год сам через Date).
  const today = new Date(Date.UTC(y, m - 1, d))
  const yesterday = new Date(today)
  yesterday.setUTCDate(today.getUTCDate() - 1)
  const yy = yesterday.getUTCFullYear()
  const mm = String(yesterday.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(yesterday.getUTCDate()).padStart(2, '0')
  return {
    from: `${yy}-${mm}-${dd} 00:00:00`,
    to: `${yy}-${mm}-${dd} 23:59:59`,
  }
}

/** Отдельная функция под шаблон запроса — удобно править набор полей в одном месте. */
function buildOlapRequest(
  config: Config,
  period: { from: string, to: string },
): IikoOlapReportRequest {
  return {
    organizationIds: [config.iikoCloudOrganizationId],
    reportType: 'SALES',
    buildSummary: true,
    groupByRowFields: ['OpenDate.Typed', 'Counterparty.Name', 'PaymentType.Name'],
    aggregateFields: ['DishSumInt', 'DishCostAfterDiscount'],
    filters: {
      'OpenDate.Typed': {
        filterType: 'DateRange',
        periodType: 'CUSTOM',
        from: period.from,
        to: period.to,
      },
    },
  }
}

export async function runIikoOlapSync(deps: IikoOlapSyncDeps): Promise<IikoOlapSyncResult> {
  const { config, sheetsRepo, logger } = deps
  const log = logger.child({ scope: 'iiko-olap-sync' })
  const startedAt = Date.now()

  const timezone = config.iikoCloudOlapScheduleTimezone || 'UTC'
  const period = computePreviousDayPeriod(timezone)

  if (!config.iikoCloudApiLogin.trim() || !config.iikoCloudOrganizationId.trim()) {
    log.info({ period }, 'iiko OLAP sync skipped: apiLogin or organizationId is empty')
    return emptyResult(period, 0, Date.now() - startedAt)
  }
  if (!config.sheetsSpreadsheetId.trim()) {
    log.info({ period }, 'iiko OLAP sync skipped: spreadsheet is not configured')
    return emptyResult(period, 0, Date.now() - startedAt)
  }

  const iiko = createIikoCloudClient({
    baseUrl: config.iikoCloudBaseUrl,
    apiLogin: config.iikoCloudApiLogin,
    logger: log,
  })

  const request = buildOlapRequest(config, period)
  log.info({ period, reportType: request.reportType }, 'iiko OLAP sync started')

  let report: IikoOlapReportResponse
  try {
    report = await iiko.getOlapReport(request)
  }
  catch (err) {
    log.error({ err, period }, 'iiko OLAP fetch failed')
    return {
      executed: true,
      rowsWritten: 0,
      durationMs: Date.now() - startedAt,
      periodFrom: period.from,
      periodTo: period.to,
      error: err,
    }
  }

  try {
    const sheetDeps = {
      sheetsRepo,
      spreadsheetId: config.sheetsSpreadsheetId,
      range: config.sheetsIikoOlapRange,
    }

    const { rowsWritten } = await writeIikoOlapReport(
      sheetDeps,
      report,
      { includeSummary: true },
    )
    const durationMs = Date.now() - startedAt
    log.info({ rowsWritten, durationMs, period }, 'iiko OLAP sync done')
    return {
      executed: true,
      rowsWritten,
      durationMs,
      periodFrom: period.from,
      periodTo: period.to,
    }
  }
  catch (err) {
    log.error({ err, period }, 'iiko OLAP write-to-sheets failed')
    return {
      executed: true,
      rowsWritten: 0,
      durationMs: Date.now() - startedAt,
      periodFrom: period.from,
      periodTo: period.to,
      error: err,
    }
  }
}

function emptyResult(
  period: { from: string, to: string },
  rowsWritten: number,
  durationMs: number,
): IikoOlapSyncResult {
  return {
    executed: false,
    rowsWritten,
    durationMs,
    periodFrom: period.from,
    periodTo: period.to,
  }
}
