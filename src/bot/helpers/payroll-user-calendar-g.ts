import type { Context } from '#root/bot/context.js'
import type { TimesheetMonthKeysJson, TimesheetTier } from '#root/bot/helpers/timesheet-sheet.js'
import { a1SheetPrefix, resolveJsonCalendarSheetLocation } from '#root/bot/helpers/json-calendar-sheet.js'
import { EMPTY_TIMESHEET_MONTH_JSON, parseTimesheetMonthKeysJsonCell } from '#root/bot/helpers/timesheet-sheet.js'

export type PayrollRequestColumnGPayload = TimesheetMonthKeysJson

export async function readUserCalendarColumnG(
  ctx: Context,
  sheetRow: number,
): Promise<PayrollRequestColumnGPayload | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!G${sheetRow}`)
    return parseTimesheetMonthKeysJsonCell(String(vals[0]?.[0] ?? ''))
  }
  catch {
    return null
  }
}

export async function writeUserCalendarColumnG(
  ctx: Context,
  sheetRow: number,
  payload: PayrollRequestColumnGPayload,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  await ctx.sheetsRepo.writeRange(spreadsheetId, `${prefix}!G${sheetRow}`, [[JSON.stringify(payload)]], 'RAW')
}

export async function clearUserCalendarColumnG(ctx: Context, sheetRow: number): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  await ctx.sheetsRepo.writeRange(spreadsheetId, `${prefix}!G${sheetRow}`, [['']], 'RAW')
}

export function emptyPayrollRequestColumnG(): PayrollRequestColumnGPayload {
  return { ...EMPTY_TIMESHEET_MONTH_JSON }
}

/** Убрать из G дни, попавшие в одобренную выплату (колонка D). */
export function stripPaidKeysFromUserCalendarColumnG(
  g: PayrollRequestColumnGPayload | null,
  paidDayKeys: string[],
): PayrollRequestColumnGPayload | null {
  if (!g)
    return null
  const rm = new Set(paidDayKeys)
  return {
    yellowKeys: g.yellowKeys.filter(k => !rm.has(k)),
    blueKeys: g.blueKeys.filter(k => !rm.has(k)),
    orangeKeys: g.orangeKeys.filter(k => !rm.has(k)),
  }
}

export function unionDayKeysFromPayrollBuckets(payload: PayrollRequestColumnGPayload): string[] {
  return [...new Set([...payload.yellowKeys, ...payload.blueKeys, ...payload.orangeKeys])]
}

export function payrollLockedKeysSet(payload: PayrollRequestColumnGPayload): Set<string> {
  return new Set(unionDayKeysFromPayrollBuckets(payload))
}

function dayKeySort(a: string, b: string): number {
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0)
      return d
  }
  return 0
}

/**
 * Итог колонки G: уже сохранённые корзины плюс черновик (цветные дни), по уровню из F.
 */
export function mergePayrollLockedAndDraftColored(
  locked: PayrollRequestColumnGPayload,
  draftColoredKeys: string[],
  eligibleTierByKey: Record<string, TimesheetTier>,
): PayrollRequestColumnGPayload {
  const yellow = new Set(locked.yellowKeys)
  const blue = new Set(locked.blueKeys)
  const orange = new Set(locked.orangeKeys)
  for (const k of draftColoredKeys) {
    const t = eligibleTierByKey[k]
    if (!t)
      continue
    yellow.delete(k)
    blue.delete(k)
    orange.delete(k)
    if (t === 1)
      yellow.add(k)
    else if (t === 2)
      blue.add(k)
    else
      orange.add(k)
  }
  return {
    yellowKeys: [...yellow].sort(dayKeySort),
    blueKeys: [...blue].sort(dayKeySort),
    orangeKeys: [...orange].sort(dayKeySort),
  }
}
