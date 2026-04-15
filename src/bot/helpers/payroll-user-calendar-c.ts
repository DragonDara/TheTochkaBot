import type { Context } from '#root/bot/context.js'
import type { TimesheetMonthKeysJson } from '#root/bot/helpers/timesheet-sheet.js'
import { a1SheetPrefix, resolveJsonCalendarSheetLocation } from '#root/bot/helpers/json-calendar-sheet.js'
import { EMPTY_TIMESHEET_MONTH_JSON, parseTimesheetMonthKeysJsonCell } from '#root/bot/helpers/timesheet-sheet.js'

/** Колонка C: накопленные корзины запросов зарплаты (как G), без дублей ключей между корзинами. */
export type UserCalendarColumnCPayload = TimesheetMonthKeysJson

export function emptyUserCalendarColumnCPayload(): UserCalendarColumnCPayload {
  return { ...EMPTY_TIMESHEET_MONTH_JSON }
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

function parseUserCalendarColumnCRaw(raw: string): UserCalendarColumnCPayload {
  const t = raw.trim()
  if (!t)
    return { ...EMPTY_TIMESHEET_MONTH_JSON }
  try {
    const parsed = JSON.parse(t) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ...EMPTY_TIMESHEET_MONTH_JSON }
    const o = parsed as { userGreenDayKeys?: unknown }
    if (Array.isArray(o.userGreenDayKeys)) {
      const yellowKeys = o.userGreenDayKeys.filter(
        (k): k is string => typeof k === 'string' && k.trim() !== '',
      )
      return { yellowKeys, blueKeys: [], orangeKeys: [] }
    }
    return parseTimesheetMonthKeysJsonCell(t)
  }
  catch {
    return { ...EMPTY_TIMESHEET_MONTH_JSON }
  }
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
    return parseUserCalendarColumnCRaw(raw)
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

/** Добавить корзины из сохранения G в C: ключ не дублируется; новая корзина заменяет старую позицию ключа. */
export function appendPayrollBucketsToColumnCDedupe(
  existing: UserCalendarColumnCPayload | null,
  toAdd: TimesheetMonthKeysJson,
): UserCalendarColumnCPayload {
  const yellow = new Set(existing?.yellowKeys ?? [])
  const blue = new Set(existing?.blueKeys ?? [])
  const orange = new Set(existing?.orangeKeys ?? [])

  const removeKey = (k: string) => {
    yellow.delete(k)
    blue.delete(k)
    orange.delete(k)
  }

  for (const k of toAdd.yellowKeys) {
    removeKey(k)
    yellow.add(k)
  }
  for (const k of toAdd.blueKeys) {
    removeKey(k)
    blue.add(k)
  }
  for (const k of toAdd.orangeKeys) {
    removeKey(k)
    orange.add(k)
  }

  return {
    yellowKeys: [...yellow].sort(dayKeySort),
    blueKeys: [...blue].sort(dayKeySort),
    orangeKeys: [...orange].sort(dayKeySort),
  }
}

/** Убрать ключи из всех корзин (одобрение / отклонение запроса). */
export function stripKeysFromUserCalendarColumnC(
  c: UserCalendarColumnCPayload | null,
  keys: string[],
): UserCalendarColumnCPayload | null {
  if (!c)
    return null
  const rm = new Set(keys)
  return {
    yellowKeys: c.yellowKeys.filter(k => !rm.has(k)),
    blueKeys: c.blueKeys.filter(k => !rm.has(k)),
    orangeKeys: c.orangeKeys.filter(k => !rm.has(k)),
  }
}

/** Оставить в C только дни из одобренных выплат (D). Остальное — сброс неодобренных запросов. */
export function filterUserCalendarColumnCToPaidKeysOnly(
  c: UserCalendarColumnCPayload | null,
  paidKeys: Set<string>,
): UserCalendarColumnCPayload {
  const base = c ?? { ...EMPTY_TIMESHEET_MONTH_JSON }
  return {
    yellowKeys: base.yellowKeys.filter(k => paidKeys.has(k)),
    blueKeys: base.blueKeys.filter(k => paidKeys.has(k)),
    orangeKeys: base.orangeKeys.filter(k => paidKeys.has(k)),
  }
}

/** @deprecated Используйте {@link stripKeysFromUserCalendarColumnC}. */
export function stripPaidKeysFromUserCalendarColumnC(
  c: UserCalendarColumnCPayload | null,
  paidGreenKeys: string[],
): UserCalendarColumnCPayload | null {
  return stripKeysFromUserCalendarColumnC(c, paidGreenKeys)
}
