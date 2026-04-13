import type { Context } from '#root/bot/context.js'
import {
  a1SheetPrefix,
  parseFirstDataRowFromRange,
  parseSheetNameFromRange,
} from '#root/bot/helpers/json-calendar-sheet.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'

export function resolveIdentificationSheetLocation(range: string): { sheetName: string, startRow: number } {
  const trimmed = range.trim()
  if (!trimmed || !trimmed.includes('!'))
    return { sheetName: 'Identification', startRow: 2 }
  return {
    sheetName: parseSheetNameFromRange(trimmed),
    startRow: parseFirstDataRowFromRange(trimmed),
  }
}

function rowHasAnyAbc(row: string[] | undefined): boolean {
  if (!row)
    return false
  for (let j = 0; j <= 2; j++) {
    if (String(row[j] ?? '').trim() !== '')
      return true
  }
  return false
}

function rowEmptyAbc(row: string[] | undefined): boolean {
  return !rowHasAnyAbc(row)
}

/**
 * Новая строка — только если A–C пусты и (это первая строка данных или в предыдущей строке уже есть данные в A–C),
 * чтобы не заполнять «дыры» между заполненными строками.
 */
function findNextIdentificationRow(rows: string[][], startRow: number): number {
  for (let i = 0; i < rows.length; i++) {
    if (!rowEmptyAbc(rows[i]))
      continue
    if (i > 0 && !rowHasAnyAbc(rows[i - 1]))
      continue
    return startRow + i
  }
  let lastPopulated = -1
  for (let i = 0; i < rows.length; i++) {
    if (rowHasAnyAbc(rows[i]))
      lastPopulated = i
  }
  return startRow + lastPopulated + 1
}

function identificationNicknameCell(from: { username?: string }): string {
  const u = from.username
  if (!u)
    return ''
  const n = normalizeTelegramUsername(u)
  return n ? `@${n}` : ''
}

/**
 * При /start: если telegram_id ещё нет в колонке B — пишет A (@ник), B (id), C (chat_id) в первую подходящую пустую строку.
 */
export async function appendIdentificationUserIfNew(ctx: Context): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return
  const from = ctx.from
  if (!from)
    return
  const chatId = ctx.chat?.id
  if (chatId === undefined)
    return

  const telegramId = String(from.id)
  const { sheetName, startRow } = resolveIdentificationSheetLocation(ctx.config.sheetsIdentificationRange)
  const prefix = a1SheetPrefix(sheetName)

  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(
      spreadsheetId,
      `${prefix}!A${startRow}:C${startRow + 4999}`,
    )
  }
  catch {
    throw new Error('read identification')
  }

  for (const row of rows) {
    if (String(row?.[1] ?? '').trim() === telegramId)
      return
  }

  const targetRow = findNextIdentificationRow(rows, startRow)

  const a = identificationNicknameCell(from)
  const b = telegramId
  const c = String(chatId)

  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!A${targetRow}:C${targetRow}`,
    [[a, b, c]],
    'USER_ENTERED',
  )
}
