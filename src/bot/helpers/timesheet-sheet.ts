import type { Context } from '#root/bot/context.js'
import type { TimesheetMonthKeysJson } from '#root/bot/helpers/timesheet-json-calendar.js'
import {
  a1SheetPrefix,
  parseFirstDataRowFromRange,
  parseSheetNameFromRange,
} from '#root/bot/helpers/json-calendar-sheet.js'
import { monthLabelRuFromParts } from '#root/bot/helpers/payment-history-sheet.js'
import { timesheetCalendarMinMaxMonth } from '#root/bot/helpers/payroll-calendar-bounds.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'

export function resolveTimesheetSheetLocation(range: string): { sheetName: string, startRow: number } {
  const trimmed = range.trim()
  if (!trimmed || !trimmed.includes('!'))
    return { sheetName: 'Timesheet', startRow: 3 }
  return {
    sheetName: parseSheetNameFromRange(trimmed),
    startRow: parseFirstDataRowFromRange(trimmed),
  }
}

export function parseTimesheetDayKey(key: string): { y: number, m: number, d: number } | null {
  const parts = key.split('-')
  if (parts.length !== 3)
    return null
  const y = Number(parts[0])
  const mo = Number(parts[1])
  const d = Number(parts[2])
  if (![y, mo, d].every(n => Number.isFinite(n)))
    return null
  return { y, m: mo, d }
}

/** Ключ календарного месяца табеля (`y-m`, m — 0-based). */
export function timesheetYmKey(y: number, m: number): string {
  return `${y}-${m}`
}

export function parseTimesheetYmKey(s: string): { y: number, m: number } | null {
  const i = s.lastIndexOf('-')
  if (i <= 0)
    return null
  const y = Number(s.slice(0, i))
  const m = Number(s.slice(i + 1))
  if (!Number.isFinite(y) || !Number.isFinite(m))
    return null
  return { y, m }
}

export function stripMonthKeysFromTimesheetPayload(
  payload: TimesheetMonthKeysJson,
  y: number,
  m: number,
): TimesheetMonthKeysJson {
  const inMonth = (k: string) => {
    const p = parseTimesheetDayKey(k)
    return p && p.y === y && p.m === m
  }
  return {
    yellowKeys: payload.yellowKeys.filter(k => !inMonth(k)),
    blueKeys: payload.blueKeys.filter(k => !inMonth(k)),
  }
}

/** Ключи дней из одного блока E или F для указанного месяца → уровни 1/2. */
export function tiersFromTimesheetMonthJsonBucket(
  payload: TimesheetMonthKeysJson,
  y: number,
  m: number,
): Record<string, 1 | 2> {
  const out: Record<string, 1 | 2> = {}
  for (const k of payload.yellowKeys) {
    const p = parseTimesheetDayKey(k)
    if (p && p.y === y && p.m === m)
      out[k] = 1
  }
  for (const k of payload.blueKeys) {
    const p = parseTimesheetDayKey(k)
    if (p && p.y === y && p.m === m)
      out[k] = 2
  }
  return out
}

export function buildTimesheetJsonEfPayloads(
  merged: Record<string, 1 | 2>,
  now: Date,
): { current: TimesheetMonthKeysJson, next: TimesheetMonthKeysJson } {
  const { min, max } = timesheetCalendarMinMaxMonth(now)
  const current: TimesheetMonthKeysJson = { yellowKeys: [], blueKeys: [] }
  const next: TimesheetMonthKeysJson = { yellowKeys: [], blueKeys: [] }
  for (const [k, tier] of Object.entries(merged)) {
    const p = parseTimesheetDayKey(k)
    if (!p)
      continue
    const isCur = p.y === min.y && p.m === min.m
    const isNxt = p.y === max.y && p.m === max.m
    if (!isCur && !isNxt)
      continue
    const bucket = isCur ? current : next
    if (tier === 1)
      bucket.yellowKeys.push(k)
    else
      bucket.blueKeys.push(k)
  }
  return { current, next }
}

function monthHasAnyKey(
  merged: Record<string, 1 | 2>,
  y: number,
  m: number,
): boolean {
  for (const k of Object.keys(merged)) {
    const p = parseTimesheetDayKey(k)
    if (p && p.y === y && p.m === m)
      return true
  }
  return false
}

export async function findTimesheetRowByMonthLabelAndUsername(
  ctx: Context,
  monthLabelRu: string,
  normalizedUsername: string,
): Promise<number | null> {
  const needle = normalizeTelegramUsername(normalizedUsername)
  if (!needle)
    return null
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName, startRow } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  const label = monthLabelRu.trim()
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!A${startRow}:B${startRow + 4999}`)
  }
  catch {
    return null
  }
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i]?.[0] ?? '').trim()
    const b = normalizeTelegramUsername(String(rows[i]?.[1] ?? ''))
    if (a === label && b === needle)
      return startRow + i
  }
  return null
}

/** Д — дневная (жёлтый), В — вечерняя (синий); D:AH = дни 1–31. */
export async function writeTimesheetDayCellsForMonth(
  ctx: Context,
  sheetRow: number,
  year: number,
  month0: number,
  tierByKey: Record<string, 1 | 2>,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const dim = new Date(year, month0 + 1, 0).getDate()
  const { sheetName } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  const cells: string[] = []
  for (let day = 1; day <= 31; day++) {
    if (day > dim) {
      cells.push('')
      continue
    }
    const k = `${year}-${month0}-${day}`
    const t = tierByKey[k]
    if (t === 1)
      cells.push('Д')
    else if (t === 2)
      cells.push('В')
    else
      cells.push('')
  }
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!D${sheetRow}:AH${sheetRow}`,
    [cells],
    'USER_ENTERED',
  )
}

export function timesheetMonthsToWriteRowsFor(
  merged: Record<string, 1 | 2>,
  now: Date,
): { y: number, m: number }[] {
  const { min, max } = timesheetCalendarMinMaxMonth(now)
  const out: { y: number, m: number }[] = []
  if (monthHasAnyKey(merged, min.y, min.m))
    out.push({ y: min.y, m: min.m })
  if (monthHasAnyKey(merged, max.y, max.m))
    out.push({ y: max.y, m: max.m })
  return out
}

/** Очистить D:AH на строках текущего и следующего месяца (Aqtobe) для пользователя, если строки есть. */
export async function clearTimesheetDayCellsForUserCurrentAndNextMonths(
  ctx: Context,
  normalizedUsername: string,
  now: Date = new Date(),
): Promise<void> {
  const { min, max } = timesheetCalendarMinMaxMonth(now)
  for (const { y, m } of [min, max]) {
    const label = monthLabelRuFromParts(y, m)
    const row = await findTimesheetRowByMonthLabelAndUsername(ctx, label, normalizedUsername)
    if (row !== null)
      await writeTimesheetDayCellsForMonth(ctx, row, y, m, {})
  }
}
