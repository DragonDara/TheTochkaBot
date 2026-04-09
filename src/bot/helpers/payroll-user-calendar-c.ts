import type { Context } from '#root/bot/context.js'
import { a1SheetPrefix, resolveJsonCalendarSheetLocation } from '#root/bot/helpers/json-calendar-sheet.js'

export interface UserCalendarColumnCPayload {
  userGreenDayKeys: string[]
}

export async function readUserCalendarColumnC(
  ctx: Context,
  sheetRow: number,
): Promise<UserCalendarColumnCPayload | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const cell = `${prefix}!C${sheetRow}`
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, cell)
    const raw = String(vals[0]?.[0] ?? '').trim()
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null
    const g = (parsed as { userGreenDayKeys?: unknown }).userGreenDayKeys
    const userGreenDayKeys = Array.isArray(g)
      ? g.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : []
    return { userGreenDayKeys }
  }
  catch {
    return null
  }
}

export async function writeUserCalendarColumnC(
  ctx: Context,
  sheetRow: number,
  payload: UserCalendarColumnCPayload,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const cell = `${prefix}!C${sheetRow}`
  await ctx.sheetsRepo.writeRange(spreadsheetId, cell, [[JSON.stringify(payload)]], 'RAW')
}

export async function clearUserCalendarColumnC(ctx: Context, sheetRow: number): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const cell = `${prefix}!C${sheetRow}`
  await ctx.sheetsRepo.writeRange(spreadsheetId, cell, [['']], 'RAW')
}

/** После одобрения зарплаты: убрать из C дни, отображаемые как ✅ (данные в D). */
export function stripPaidKeysFromUserCalendarColumnC(
  c: UserCalendarColumnCPayload | null,
  paidGreenKeys: string[],
): UserCalendarColumnCPayload | null {
  if (!c)
    return null
  const pg = new Set(paidGreenKeys)
  const greens = c.userGreenDayKeys.filter(k => !pg.has(k))
  return { userGreenDayKeys: greens }
}
