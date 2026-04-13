import type { Context } from '#root/bot/context.js'
import { resolveIdentificationSheetLocation } from '#root/bot/helpers/identification-sheet.js'
import { a1SheetPrefix } from '#root/bot/helpers/json-calendar-sheet.js'
import { listPayrollAccountantUsernamesFromUsersSheet } from '#root/bot/helpers/payroll-users-sheet.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'

/** Числовые chat_id из Identification (колонка C) для бухгалтеров из Users (H), совпадение по A (регистронезависимо). */
async function accountantPrivateChatIdsFromIdentification(ctx: Context): Promise<number[]> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return []
  const accountantRaw = await listPayrollAccountantUsernamesFromUsersSheet(ctx)
  if (accountantRaw.length === 0)
    return []

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
    return []
  }

  const chatIdByNick = new Map<string, number>()
  for (const row of rows) {
    const nickKey = normalizeTelegramUsername(String(row[0] ?? ''))
    if (!nickKey)
      continue
    const chatRaw = String(row[2] ?? '').trim()
    if (!chatRaw)
      continue
    const chatId = Number(chatRaw)
    if (!Number.isFinite(chatId))
      continue
    chatIdByNick.set(nickKey, chatId)
  }

  const out: number[] = []
  const seen = new Set<number>()
  for (const raw of accountantRaw) {
    const k = normalizeTelegramUsername(raw)
    const id = chatIdByNick.get(k)
    if (id !== undefined && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** Личные сообщения бухгалтерам, которые есть в Identification (уже писали боту). */
export async function notifyAccountantsText(ctx: Context, text: string): Promise<void> {
  const t = text.trim()
  if (!t)
    return
  const ids = await accountantPrivateChatIdsFromIdentification(ctx)
  for (const chatId of ids) {
    try {
      await ctx.api.sendMessage(chatId, t)
    }
    catch (err) {
      ctx.logger.warn({ err, chatId }, 'Failed to notify accountant')
    }
  }
}
