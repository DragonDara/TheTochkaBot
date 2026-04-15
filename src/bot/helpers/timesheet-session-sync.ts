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
  EMPTY_TIMESHEET_APPROVED_FROZEN_JSON,
  EMPTY_TIMESHEET_MONTH_JSON,
  findTimesheetRowByMonthLabelAndUsername,
  readJsonCalendarTimesheetColumnE,
  readJsonCalendarTimesheetColumnF,
  stripMonthKeysFromApprovedFrozenSnapshot,
  stripMonthKeysFromTimesheetPayload,
  tiersFromApprovedFrozenSnapshot,
  tiersFromTimesheetMonthJsonBucket,
  timesheetYmKey,
  writeJsonCalendarTimesheetColumnE,
  writeJsonCalendarTimesheetColumnF,
} from '#root/bot/helpers/timesheet-sheet.js'

type TimesheetSession = NonNullable<Context['session']['timesheetCalendar']>

/**
 * После «Заполнить табель»: AI, E и F; при отклонении — чистка E/F месяца;
 * при одобрении — снимок из F (если есть), иначе из E.
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

  const readF = await readJsonCalendarTimesheetColumnF(ctx, jsonRow)
  let frozenSnap = readF ?? { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }

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
    const strippedF = stripMonthKeysFromApprovedFrozenSnapshot(frozenSnap, min.y, min.m)
    if (JSON.stringify(strippedF) !== JSON.stringify(frozenSnap)) {
      frozenSnap = strippedF
      try {
        await writeJsonCalendarTimesheetColumnF(ctx, jsonRow, frozenSnap)
      }
      catch (error) {
        ctx.logger.error({ err: error }, 'Failed to write stripped timesheet JSON F on entry')
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
    const fromF = tiersFromApprovedFrozenSnapshot(frozenSnap, min.y, min.m)
    const fromE = tiersFromTimesheetMonthJsonBucket(current, min.y, min.m)
    const tiers = Object.keys(fromF).length > 0 ? fromF : fromE
    Object.assign(locked, tiers)
    if (norm === 'approved') {
      ts.approvedFrozenDayKeys = [...new Set(Object.keys(tiers))]
    }
  }

  ts.lockedDayStates = locked
  ts.draftDayStates = {}
  ts.selectionAnchorMonth = undefined
}
