import type { Config } from '#root/config.js'
import type { IikoOlapReportResponse } from '#root/integrations/iiko-cloud.js'
import type { SheetsRepo } from '#root/repos/sheets-repo.js'
import type { Logger } from 'pino'
import { writeIikoOlapReport } from '#root/bot/helpers/iiko-olap-sheet.js'
import { createIikoCloudClient } from '#root/integrations/iiko-cloud.js'
import {
  IIKO_OLAP_PRESETS,
  isIikoOlapPresetKey,
} from '#root/jobs/iiko-olap-presets.js'

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

  const presetKey = config.iikoCloudOlapPreset.trim()
  if (!isIikoOlapPresetKey(presetKey)) {
    log.error({ presetKey, available: Object.keys(IIKO_OLAP_PRESETS) }, 'unknown iiko OLAP preset, sync aborted')
    return emptyResult(period, 0, Date.now() - startedAt)
  }

  const preset = IIKO_OLAP_PRESETS[presetKey]
  const request = preset.build({
    organizationId: config.iikoCloudOrganizationId,
    period,
  })

  log.info({
    preset: presetKey,
    description: preset.description,
    reportType: request.reportType,
    period,
  }, 'iiko OLAP sync started')

  const iiko = createIikoCloudClient({
    baseUrl: config.iikoCloudBaseUrl,
    apiLogin: config.iikoCloudApiLogin,
    logger: log,
  })

  let report: IikoOlapReportResponse
  try {
    report = await iiko.getOlapReport(request)
  }
  catch (err) {
    log.error({ err, preset: presetKey, period }, 'iiko OLAP fetch failed')
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
      { includeSummary: true, columns: preset.sheetColumns },
    )
    const durationMs = Date.now() - startedAt
    log.info({ preset: presetKey, rowsWritten, durationMs, period }, 'iiko OLAP sync done')
    return {
      executed: true,
      rowsWritten,
      durationMs,
      periodFrom: period.from,
      periodTo: period.to,
    }
  }
  catch (err) {
    log.error({ err, preset: presetKey, period }, 'iiko OLAP write-to-sheets failed')
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
