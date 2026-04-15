import type { Context } from '#root/bot/context.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'

/** Строка на листе JSON Calendar: совпадение A с @username (нормализованно), иначе первая пустая A, иначе новая строка. */
function computeJsonCalendarTargetRowFromAColumn(
  values: string[][],
  startRow: number,
  normalizedUsername: string,
): number {
  for (let i = 0; i < values.length; i++) {
    if (normalizeTelegramUsername(String(values[i]?.[0] ?? '')) === normalizedUsername)
      return startRow + i
  }
  for (let i = 0; i < values.length; i++) {
    if (!normalizeTelegramUsername(String(values[i]?.[0] ?? '')))
      return startRow + i
  }
  return startRow + values.length
}

/** Имя листа из диапазона вида Users!A1 или 'JSON Calendar'!A2:B */
export function parseSheetNameFromRange(range: string): string {
  const m = range.trim().match(/^(.*)!/)
  if (!m)
    return 'Users'
  return m[1].replace(/^'|'$/g, '').trim()
}

/** Первая строка данных в диапазоне (например A2 -> 2). */
export function parseFirstDataRowFromRange(range: string): number {
  const m = range.match(/![a-z]+(\d+)/i)
  return m ? Number.parseInt(m[1], 10) : 2
}

const DEFAULT_JSON_CALENDAR_SHEET = 'JSON Calendar'
const DEFAULT_JSON_CALENDAR_START_ROW = 2

/**
 * Лист и первая строка данных для JSON календаря (A–G: … E табель, F одобренный табель, G запрос зарплаты).
 * Не подставляет лист Users: при пустом range, без `!` или если в range указан лист Users — используется «JSON Calendar».
 */
export function resolveJsonCalendarSheetLocation(range: string): { sheetName: string, startRow: number } {
  const trimmed = range.trim()
  if (!trimmed || !trimmed.includes('!')) {
    return { sheetName: DEFAULT_JSON_CALENDAR_SHEET, startRow: DEFAULT_JSON_CALENDAR_START_ROW }
  }
  const sheetName = parseSheetNameFromRange(trimmed)
  const startRow = parseFirstDataRowFromRange(trimmed)
  if (sheetName === 'Users')
    return { sheetName: DEFAULT_JSON_CALENDAR_SHEET, startRow: DEFAULT_JSON_CALENDAR_START_ROW }
  return { sheetName, startRow }
}

export function a1SheetPrefix(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, '\'\'')
  const needsQuote = sheetName.includes(' ') || !/^\w+$/.test(sheetName)
  return needsQuote ? `'${escaped}'` : sheetName
}

/** Колонка A листа Users: @username (как в таблице). */
export async function readUsersSheetColumnA(ctx: Context, sheetRow: number): Promise<string | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const payrollRange = ctx.config.sheetsPayrollRequestsRange
  const sheetName = parseSheetNameFromRange(payrollRange)
  const cell = `${a1SheetPrefix(sheetName)}!A${sheetRow}`
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, cell)
    const id = String(vals[0]?.[0] ?? '').trim()
    return id || null
  }
  catch {
    return null
  }
}

/**
 * Пишет JSON в колонку B листа из `sheetsJsonCalendarRange` (A — @username, B — JSON).
 * Строка ищется по совпадению A с нормализованным username; иначе — первая пустая A или новая строка под данными.
 */
export async function writeJsonCalendarForUsername(
  ctx: Context,
  normalizedUsername: string,
  payload: { selectedDayKeys: string[] },
): Promise<void> {
  const key = normalizeTelegramUsername(normalizedUsername)
  if (!key)
    throw new Error('Empty username key')

  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')

  const { sheetName, startRow } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const readA = `${prefix}!A${startRow}:A`

  const values = await ctx.sheetsRepo.readRange(spreadsheetId, readA)
  const targetRow = computeJsonCalendarTargetRowFromAColumn(values, startRow, key)

  const json = JSON.stringify(payload)
  const writeRange = `${prefix}!A${targetRow}:B${targetRow}`
  await ctx.sheetsRepo.writeRange(spreadsheetId, writeRange, [[key, json]], 'RAW')
}

/** Строка листа из `sheetsJsonCalendarRange`, где A = @username; иначе null. */
export async function findJsonCalendarSheetRowForUsername(
  ctx: Context,
  normalizedUsername: string,
): Promise<number | null> {
  const needle = normalizeTelegramUsername(normalizedUsername)
  if (!needle)
    return null

  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null

  const { sheetName, startRow } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const values = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!A${startRow}:A`)

  for (let i = 0; i < values.length; i++) {
    if (normalizeTelegramUsername(String(values[i]?.[0] ?? '')) === needle)
      return startRow + i
  }
  return null
}

/**
 * Гарантирует строку на листе JSON Calendar с A = нормализованный @username.
 * Если строки не было — создаёт (B = `{"selectedDayKeys":[]}`), чтобы колонку C можно было заполнить.
 */
export async function ensureJsonCalendarSheetRowForUsername(
  ctx: Context,
  normalizedUsername: string,
): Promise<number> {
  const key = normalizeTelegramUsername(normalizedUsername)
  if (!key)
    throw new Error('Empty username key')

  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')

  const { sheetName, startRow } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const readA = `${prefix}!A${startRow}:A`
  const values = await ctx.sheetsRepo.readRange(spreadsheetId, readA)

  for (let i = 0; i < values.length; i++) {
    if (normalizeTelegramUsername(String(values[i]?.[0] ?? '')) === key)
      return startRow + i
  }

  const targetRow = computeJsonCalendarTargetRowFromAColumn(values, startRow, key)
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!A${targetRow}:B${targetRow}`,
    [[key, '{"selectedDayKeys":[]}']],
    'RAW',
  )
  return targetRow
}

/** Читает JSON из колонки B для строки с данным @username в колонке A. */
export async function readJsonCalendarForUsername(
  ctx: Context,
  normalizedUsername: string,
): Promise<{ selectedDayKeys: string[] } | null> {
  const needle = normalizeTelegramUsername(normalizedUsername)
  if (!needle)
    return null

  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null

  const { sheetName, startRow } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const readAB = `${prefix}!A${startRow}:B`

  let values: string[][]
  try {
    values = await ctx.sheetsRepo.readRange(spreadsheetId, readAB)
  }
  catch {
    return null
  }

  for (let i = 0; i < values.length; i++) {
    if (normalizeTelegramUsername(String(values[i]?.[0] ?? '')) !== needle)
      continue
    const raw = String(values[i]?.[1] ?? '').trim()
    if (!raw)
      return null
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null
      const keys = (parsed as { selectedDayKeys?: unknown }).selectedDayKeys
      if (!Array.isArray(keys))
        return null
      const selectedDayKeys = keys.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      return { selectedDayKeys }
    }
    catch {
      return null
    }
  }

  return null
}
