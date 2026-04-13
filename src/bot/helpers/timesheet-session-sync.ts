import type { Context } from '#root/bot/context.js'
import { ensureJsonCalendarSheetRowForUsername } from '#root/bot/helpers/json-calendar-sheet.js'
import { monthLabelRuFromParts } from '#root/bot/helpers/payment-history-sheet.js'
import { timesheetCalendarMinMaxMonth } from '#root/bot/helpers/payroll-calendar-bounds.js'
import {
  normalizeTimesheetApprovalStatusCell,
  readTimesheetApprovalStatusCell,
} from '#root/bot/helpers/timesheet-approval-sheet.js'
import {
  EMPTY_TIMESHEET_MONTH_JSON,
  readJsonCalendarTimesheetColumnsEF,
  writeJsonCalendarTimesheetColumnsEF,
} from '#root/bot/helpers/timesheet-json-calendar.js'
import {
  findTimesheetRowByMonthLabelAndUsername,
  stripMonthKeysFromTimesheetPayload,
  tiersFromTimesheetMonthJsonBucket,
  timesheetYmKey,
} from '#root/bot/helpers/timesheet-sheet.js'

type TimesheetSession = NonNullable<Context['session']['timesheetCalendar']>

/**
 * После «Заполнить табель»: читает AI (текущий/следующий месяц Aqtobe), E/F JSON;
 * при «Не одобрен» — сбрасывает ключи месяца в E/F и помечает очистку D:AH при следующем сохранении;
 * при «Одобрен» — ключи из E/F в locked и в approvedFrozenDayKeys (только они ✔️/☑️; новые отметки — 🟡/🔵).
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

  const { min, max } = timesheetCalendarMinMaxMonth(now)
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

  const read = await readJsonCalendarTimesheetColumnsEF(ctx, jsonRow)
  let current = read?.current ?? { ...EMPTY_TIMESHEET_MONTH_JSON }
  let next = read?.next ?? { ...EMPTY_TIMESHEET_MONTH_JSON }

  type Norm = 'approved' | 'rejected' | 'pending'
  const monthStatuses: Array<{ y: number, m: number, norm: Norm }> = []

  for (const { y, m } of [min, max]) {
    const label = monthLabelRuFromParts(y, m)
    const row = await findTimesheetRowByMonthLabelAndUsername(ctx, label, sheetUser)
    if (row === null) {
      monthStatuses.push({ y, m, norm: 'pending' })
      continue
    }
    const ai = await readTimesheetApprovalStatusCell(ctx, row)
    const norm = normalizeTimesheetApprovalStatusCell(ai ?? '')
    monthStatuses.push({ y, m, norm })
  }

  let efChanged = false
  for (const { y, m, norm } of monthStatuses) {
    if (norm !== 'rejected')
      continue
    const bucket = y === min.y && m === min.m ? current : next
    const stripped = stripMonthKeysFromTimesheetPayload(bucket, y, m)
    if (JSON.stringify(stripped) !== JSON.stringify(bucket)) {
      if (y === min.y && m === min.m)
        current = stripped
      else
        next = stripped
      efChanged = true
    }
  }

  if (efChanged) {
    try {
      await writeJsonCalendarTimesheetColumnsEF(ctx, jsonRow, current, next)
    }
    catch (error) {
      ctx.logger.error({ err: error }, 'Failed to write stripped timesheet JSON E/F on entry')
    }
  }

  const locked: Record<string, 1 | 2> = {}

  for (const { y, m, norm } of monthStatuses) {
    const ym = timesheetYmKey(y, m)
    if (norm === 'approved') {
      ts.monthApprovalByYm[ym] = 'approved'
    }
    else if (norm === 'rejected') {
      ts.monthApprovalByYm[ym] = 'rejected'
      const prev: { y: number, m: number }[] = ts.pendingClearTimesheetDahForMonths ?? []
      if (!prev.some(p => p.y === y && p.m === m)) {
        ts.pendingClearTimesheetDahForMonths = [...prev, { y, m }]
      }
      else {
        ts.pendingClearTimesheetDahForMonths = prev
      }
    }
    else {
      ts.monthApprovalByYm[ym] = 'none'
    }

    if (norm === 'rejected') {
      continue
    }

    const bucket = y === min.y && m === min.m ? current : next
    const tiers = tiersFromTimesheetMonthJsonBucket(bucket, y, m)
    Object.assign(locked, tiers)
    if (norm === 'approved') {
      const prev: string[] = ts.approvedFrozenDayKeys ?? []
      const fromTiers = Object.keys(tiers)
      ts.approvedFrozenDayKeys = [...new Set([...prev, ...fromTiers])]
    }
  }

  ts.lockedDayStates = locked
  ts.draftDayStates = {}
  ts.selectionAnchorMonth = undefined
}
