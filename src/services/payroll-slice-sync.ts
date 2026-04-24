import type { Config } from '#root/config.js'
import type { Logger } from '#root/logger.js'
import type { SheetsRepo } from '#root/repos/sheets-repo.js'
import type { IikoEmployeeRecord, SalaryOnDate } from '#root/types/iiko-salary.js'
import { buildPayrollSliceRows } from '#root/bot/helpers/payroll-slice-mapper.js'
import { createIikoServerClient } from '#root/integrations/iiko-server.js'
import { mapWithConcurrency } from '#root/utils/map-limit.js'
import { formatSliceYmd } from '#root/utils/payroll-slice-date.js'

function isIikoServerConfigured(c: Config): boolean {
  return (
    c.iikoServerBaseUrl.trim() !== ''
    && c.iikoServerLogin.trim() !== ''
    && c.iikoServerPassword !== ''
  )
}

export function defaultPayrollSliceDate(config: Config, at: Date = new Date()): string {
  return formatSliceYmd(at, config.iikoServerTz, config.payrollSliceOffsetDays)
}

export interface SyncPayrollSliceDeps {
  config: Config
  sheetsRepo: SheetsRepo
  logger: Logger
}

/**
 * Срез окладов на дату: сотрудники + `salary/byId/{id}/{date}` → одна `append` в лист; дедуп по `Sync Status` (J1).
 */
export async function syncPayrollSliceToSheet(
  deps: SyncPayrollSliceDeps,
  input: { sliceDate: string, force?: boolean },
): Promise<{ kind: 'skipped', reason: string } | { kind: 'ok', rowCount: number } | { kind: 'noop', reason: string }> {
  const { config, sheetsRepo, logger } = deps
  const { sliceDate, force = false } = input

  const spreadsheetId = config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId) {
    return { kind: 'noop', reason: 'SHEETS_SPREADSHEET_ID is empty' }
  }
  if (!isIikoServerConfigured(config)) {
    return { kind: 'noop', reason: 'iikoServer is not configured (set IIKO_SERVER_BASE_URL, LOGIN, PASSWORD)' }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(sliceDate)) {
    throw new Error(`Invalid sliceDate (expected YYYY-MM-DD): ${sliceDate}`)
  }

  if (!force) {
    const statusRange = config.sheetsPayrollSyncStatusRange.trim()
    try {
      const st = await sheetsRepo.readRange(spreadsheetId, statusRange, { valueRenderOption: 'UNFORMATTED_VALUE' })
      const j1 = String(st[0]?.[0] ?? '').trim()
      if (j1 === sliceDate) {
        logger.info({ msg: 'payroll slice skipped (already synced for date)', sliceDate, statusRange })
        return { kind: 'skipped', reason: 'already_synced' }
      }
    }
    catch (e) {
      logger.warn({ e }, 'payroll: could not read sync status, continuing')
    }
  }

  const iiko = createIikoServerClient({
    baseUrl: config.iikoServerBaseUrl.trim(),
    login: config.iikoServerLogin.trim(),
    password: config.iikoServerPassword,
    timeoutMs: config.iikoServerTimeoutMs,
    maxRetries: config.iikoServerMaxRetries,
    retryBaseMs: config.iikoServerRetryBaseMs,
    tlsInsecure: config.iikoServerTlsInsecure,
    tlsCaPath: config.iikoServerTlsCa,
  })

  const { rows, fetchedAtIso } = await iiko.withSession(async (api) => {
    const emps: IikoEmployeeRecord[] = await api.getEmployees()
    if (emps.length === 0) {
      logger.warn('payroll: empty employee list from iikoServer')
    }
    const salaries = new Map<string, SalaryOnDate | null>()
    const conc = config.payrollConcurrency
    const pairs = await mapWithConcurrency(emps, conc, async (e) => {
      const s = await api.getEmployeeSalaryOnDate(e.id, sliceDate)
      return { id: e.id, s: s as SalaryOnDate | null }
    })
    for (const p of pairs) {
      salaries.set(String(p.id), p.s)
    }
    const at = new Date().toISOString()
    return {
      rows: buildPayrollSliceRows({
        sliceDate,
        employees: emps,
        salaryByEmployeeId: salaries,
        fetchedAtIso: at,
      }),
      fetchedAtIso: at,
    }
  })

  await sheetsRepo.appendRange(
    spreadsheetId,
    config.sheetsPayrollExportRange,
    rows,
    'USER_ENTERED',
    'INSERT_ROWS',
  )
  await sheetsRepo.writeRange(
    spreadsheetId,
    config.sheetsPayrollSyncStatusRange,
    [
      [sliceDate],
      [fetchedAtIso],
    ],
    'USER_ENTERED',
  )
  logger.info({ msg: 'payroll slice appended', sliceDate, rowCount: rows.length })
  return { kind: 'ok', rowCount: rows.length }
}
