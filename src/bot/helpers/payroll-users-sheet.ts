import type { Context } from '#root/bot/context.js'
import { a1SheetPrefix, parseFirstDataRowFromRange, parseSheetNameFromRange } from '#root/bot/helpers/json-calendar-sheet.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'

/** Числа D/E без форматирования (₽, пробелы), формулы — как число. */
const usersSheetReadOptions = { valueRenderOption: 'UNFORMATTED_VALUE' as const }

/** Префикс листа из `sheetsPayrollRequestsRange` для A1-нотации (кавычки при пробелах в имени). */
export function usersPayrollSheetPrefix(ctx: Context): string {
  const name = parseSheetNameFromRange(ctx.config.sheetsPayrollRequestsRange.trim())
  return a1SheetPrefix(name)
}

/** Значение столбца H листа Users — доступ к меню сотрудника (одобрение запросов и т.д.). */
export const USERS_SHEET_ACCOUNTANT_ROLE = 'Бухгалтер'

/** Индекс столбца H в строке, прочитанной диапазоном A:H (A = 0). */
export const USERS_SHEET_ROLE_COLUMN_INDEX = 7

export function isUsersSheetAccountantRow(row: string[]): boolean {
  return String(row[USERS_SHEET_ROLE_COLUMN_INDEX] ?? '').trim() === USERS_SHEET_ACCOUNTANT_ROLE
}

/**
 * Фактический диапазон чтения Users: **A–H** (username, ФИО, …, D/E для суммы, G — должность, H — роль).
 * Хвост диапазона из env не расширяет чтение за H.
 */
export function usersPayrollSheetDataRange(ctx: Context): string | null {
  const configured = ctx.config.sheetsPayrollRequestsRange.trim()
  if (!configured || !configured.includes('!'))
    return null
  const sheetName = parseSheetNameFromRange(configured)
  const startRow = parseFirstDataRowFromRange(configured)
  return `${a1SheetPrefix(sheetName)}!A${startRow}:H`
}

/** @username из колонки A для всех строк, где H = «Бухгалтер». */
export async function listPayrollAccountantUsernamesFromUsersSheet(ctx: Context): Promise<string[]> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  const dataRange = usersPayrollSheetDataRange(ctx)
  if (!spreadsheetId || !dataRange)
    return []
  let values: string[][]
  try {
    values = await ctx.sheetsRepo.readRange(spreadsheetId, dataRange, usersSheetReadOptions)
  }
  catch {
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of values) {
    if (!isUsersSheetAccountantRow(r))
      continue
    const raw = String(r[0] ?? '').trim()
    const key = normalizeTelegramUsername(raw)
    if (!key || seen.has(key))
      continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

/** Строка на листе Users (диапазон зарплат): колонка A — Telegram @username (без @, регистр не важен). */
export async function findUsersPayrollRowByUsername(
  ctx: Context,
  normalizedUsername: string,
): Promise<{ rowNumber: number, row: string[] } | null> {
  const needle = normalizeTelegramUsername(normalizedUsername)
  if (!needle)
    return null
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const dataRange = usersPayrollSheetDataRange(ctx)
  if (!dataRange)
    return null
  let values: string[][]
  try {
    values = await ctx.sheetsRepo.readRange(spreadsheetId, dataRange, usersSheetReadOptions)
  }
  catch {
    return null
  }
  const startRow = parseFirstDataRowFromRange(ctx.config.sheetsPayrollRequestsRange.trim())
  const rowIndex = values.findIndex(r => normalizeTelegramUsername(String(r[0] ?? '')) === needle)
  if (rowIndex < 0)
    return null
  return { rowNumber: startRow + rowIndex, row: values[rowIndex]! }
}

/** Колонка G (индекс 6 в A:H) — должность; ключ — `normalizeTelegramUsername` колонки A. */
export async function usersPayrollPositionByNormalizedUsernameMap(
  ctx: Context,
): Promise<Map<string, string>> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  const dataRange = usersPayrollSheetDataRange(ctx)
  const out = new Map<string, string>()
  if (!spreadsheetId || !dataRange)
    return out
  let values: string[][]
  try {
    values = await ctx.sheetsRepo.readRange(spreadsheetId, dataRange, usersSheetReadOptions)
  }
  catch {
    return out
  }
  for (const r of values) {
    const key = normalizeTelegramUsername(String(r[0] ?? ''))
    if (!key)
      continue
    const pos = String(r[6] ?? '').trim()
    out.set(key, pos)
  }
  return out
}

/** Номер строки на листе Users (колонка B = ФИО). При дубликатах ФИО — первая найденная строка. */
export async function findUsersPayrollRowNumberByFio(ctx: Context, fio: string): Promise<number | null> {
  const trimmed = fio.trim()
  if (!trimmed)
    return null
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  const dataRange = usersPayrollSheetDataRange(ctx)
  if (!spreadsheetId || !dataRange)
    return null
  let values: string[][]
  try {
    values = await ctx.sheetsRepo.readRange(spreadsheetId, dataRange, usersSheetReadOptions)
  }
  catch {
    return null
  }
  const startRow = parseFirstDataRowFromRange(ctx.config.sheetsPayrollRequestsRange.trim())
  const rowIndex = values.findIndex(r => String(r[1] ?? '').trim() === trimmed)
  if (rowIndex < 0)
    return null
  return startRow + rowIndex
}
