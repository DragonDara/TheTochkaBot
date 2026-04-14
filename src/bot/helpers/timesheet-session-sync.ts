import type { Context } from '#root/bot/context.js'
import type { TimesheetTier } from '#root/bot/helpers/timesheet-sheet.js'
import { ensureJsonCalendarSheetRowForUsername } from '#root/bot/helpers/json-calendar-sheet.js'
import { monthLabelRuFromParts } from '#root/bot/helpers/payment-history-sheet.js'
import { timesheetCalendarMinMaxMonth } from '#root/bot/helpers/payroll-calendar-bounds.js'
import {
  normalizeTimesheetApprovalStatusCell,
  readTimesheetApprovalStatusCell,
} from '#root/bot/helpers/timesheet-approval-sheet.js'
import {
  EMPTY_TIMESHEET_MONTH_JSON,
  findTimesheetRowByMonthLabelAndUsername,
  readJsonCalendarTimesheetColumnE,
  stripMonthKeysFromTimesheetPayload,
  tiersFromTimesheetMonthJsonBucket,
  timesheetYmKey,
  writeJsonCalendarTimesheetColumnE,
} from '#root/bot/helpers/timesheet-sheet.js'

type TimesheetSession = NonNullable<Context['session']['timesheetCalendar']>

/**
 * После «Заполнить табель»: читает AI (текущий месяц Aqtobe), JSON в E;
 * при «Не одобрен» — сбрасывает ключи месяца в E и помечает очистку D:AH при следующем сохранении;
 * при «Одобрен» — ключи из E в locked и approvedFrozenDayKeys (галочки в UI), новые отметки — жёлтый/синий.
 */
export async function syncTimesheetSessionOnEntry(
  ctx: Context,
  ts: TimesheetSession,
  sheetUser: string,
  now: Date,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return

  const { min } = timesheetCalendarMinMaxMonth(now)
  ts.monthApprovalByYm = {}
  ts.approvedFrozenDayKeys = []
  ts.pendingClearTimesheetDahForMonths = []

  let jsonRow: number
  try {
    jsonRow = await ensureJsonCalendarSheetRowForUsername(ctx, sheetUser)
  }
  catch {
    return
  }

  const read = await readJsonCalendarTimesheetColumnE(ctx, jsonRow)
  let current = read ?? { ...EMPTY_TIMESHEET_MONTH_JSON }

  type Norm = 'approved' | 'rejected' | 'pending'
  const label = monthLabelRuFromParts(min.y, min.m)
  const row = await findTimesheetRowByMonthLabelAndUsername(ctx, label, sheetUser)
  let norm: Norm = 'pending'
  if (row !== null) {
    const ai = await readTimesheetApprovalStatusCell(ctx, row)
    norm = normalizeTimesheetApprovalStatusCell(ai ?? '')
  }

  if (norm === 'rejected') {
    const stripped = stripMonthKeysFromTimesheetPayload(current, min.y, min.m)
    if (JSON.stringify(stripped) !== JSON.stringify(current)) {
      current = stripped
      try {
        await writeJsonCalendarTimesheetColumnE(ctx, jsonRow, current)
      }
      catch (error) {
        ctx.logger.error({ err: error }, 'Failed to write stripped timesheet JSON E on entry')
      }
    }
  }

  const ym = timesheetYmKey(min.y, min.m)
  const locked: Record<string, TimesheetTier> = {}

  if (norm === 'approved') {
    ts.monthApprovalByYm[ym] = 'approved'
  }
  else if (norm === 'rejected') {
    ts.monthApprovalByYm[ym] = 'rejected'
    ts.pendingClearTimesheetDahForMonths = [{ y: min.y, m: min.m }]
  }
  else {
    ts.monthApprovalByYm[ym] = 'none'
  }

  if (norm !== 'rejected') {
    const tiers = tiersFromTimesheetMonthJsonBucket(current, min.y, min.m)
    Object.assign(locked, tiers)
    if (norm === 'approved') {
      ts.approvedFrozenDayKeys = [...new Set(Object.keys(tiers))]
    }
  }

  ts.lockedDayStates = locked
  ts.draftDayStates = {}
  ts.selectionAnchorMonth = undefined
}
