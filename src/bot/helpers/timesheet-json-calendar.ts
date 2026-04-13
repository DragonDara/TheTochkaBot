import type { Context } from '#root/bot/context.js'
import { a1SheetPrefix, resolveJsonCalendarSheetLocation } from '#root/bot/helpers/json-calendar-sheet.js'

/** JSON в E (текущий месяц Aqtobe) и F (следующий): отдельно жёлтые и синие ключи дней `y-m-d`. */
export interface TimesheetMonthKeysJson {
  yellowKeys: string[]
  blueKeys: string[]
}

export const EMPTY_TIMESHEET_MONTH_JSON: TimesheetMonthKeysJson = { yellowKeys: [], blueKeys: [] }

/** Разбор ячейки E или F в структуру ключей табеля. */
export function parseTimesheetMonthKeysJsonCell(raw: string): TimesheetMonthKeysJson {
  const t = raw.trim()
  if (!t)
    return { ...EMPTY_TIMESHEET_MONTH_JSON }
  try {
    const parsed = JSON.parse(t) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ...EMPTY_TIMESHEET_MONTH_JSON }
    const o = parsed as { yellowKeys?: unknown, blueKeys?: unknown }
    const yellowKeys = Array.isArray(o.yellowKeys)
      ? o.yellowKeys.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : []
    const blueKeys = Array.isArray(o.blueKeys)
      ? o.blueKeys.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : []
    return { yellowKeys, blueKeys }
  }
  catch {
    return { ...EMPTY_TIMESHEET_MONTH_JSON }
  }
}

export async function readJsonCalendarTimesheetColumnsEF(
  ctx: Context,
  sheetRow: number,
): Promise<{ current: TimesheetMonthKeysJson, next: TimesheetMonthKeysJson } | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!E${sheetRow}:F${sheetRow}`)
    const e = String(vals[0]?.[0] ?? '')
    const f = String(vals[0]?.[1] ?? '')
    return {
      current: parseTimesheetMonthKeysJsonCell(e),
      next: parseTimesheetMonthKeysJsonCell(f),
    }
  }
  catch {
    return null
  }
}

export async function writeJsonCalendarTimesheetColumnsEF(
  ctx: Context,
  sheetRow: number,
  currentMonth: TimesheetMonthKeysJson,
  nextMonth: TimesheetMonthKeysJson,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!E${sheetRow}:F${sheetRow}`,
    [[JSON.stringify(currentMonth), JSON.stringify(nextMonth)]],
    'RAW',
  )
}

/** Очистить JSON табеля в колонках E и F (как после сохранения с пустыми ключами). */
export async function clearJsonCalendarTimesheetColumnsEF(
  ctx: Context,
  sheetRow: number,
): Promise<void> {
  await writeJsonCalendarTimesheetColumnsEF(
    ctx,
    sheetRow,
    EMPTY_TIMESHEET_MONTH_JSON,
    EMPTY_TIMESHEET_MONTH_JSON,
  )
}
