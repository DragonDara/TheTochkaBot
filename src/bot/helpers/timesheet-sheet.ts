import type { Context } from '#root/bot/context.js'
import {
  a1SheetPrefix,
  parseFirstDataRowFromRange,
  parseSheetNameFromRange,
  resolveJsonCalendarSheetLocation,
} from '#root/bot/helpers/json-calendar-sheet.js'
import { monthLabelRuFromParts, parseSheetNumericCell } from '#root/bot/helpers/payment-history-sheet.js'
import { timesheetCalendarMinMaxMonth } from '#root/bot/helpers/payroll-calendar-bounds.js'
import { findUsersPayrollRowByUsername } from '#root/bot/helpers/payroll-users-sheet.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'

/** Лист Users (A:H): ставки для суммы в AJ табеля — колонки E и F. */
const USERS_TIMESHEET_DAY_RATE_INDEX = 4
const USERS_TIMESHEET_EVENING_RATE_INDEX = 5

/** Уровень смены в табеле: 1 — дневная, 2 — вечерняя, 3 — обе (только «Повар»). */
export type TimesheetTier = 1 | 2 | 3

/** Режим переключения дня по клику (задаётся должностью, колонка G листа Users). */
export type TimesheetShiftMode = 'hookah' | 'runner_waiter' | 'cook' | 'default'

/** JSON в E листа JSON Calendar: ключи дней `y-m-d` для черновика табеля. */
export interface TimesheetMonthKeysJson {
  yellowKeys: string[]
  blueKeys: string[]
  /** Обе смены в один день (оранжевая кнопка в боте); только «Повар». */
  orangeKeys: string[]
}

export const EMPTY_TIMESHEET_MONTH_JSON: TimesheetMonthKeysJson = {
  yellowKeys: [],
  blueKeys: [],
  orangeKeys: [],
}

/**
 * JSON в F после одобрения табеля: три списка ключей дней `y-m-d` (check / ballot / radio в UI).
 */
export interface TimesheetApprovedFrozenSnapshotJson {
  checkMarkedDayKeys: string[]
  ballotMarkedDayKeys: string[]
  radioMarkedDayKeys: string[]
}

export const EMPTY_TIMESHEET_APPROVED_FROZEN_JSON: TimesheetApprovedFrozenSnapshotJson = {
  checkMarkedDayKeys: [],
  ballotMarkedDayKeys: [],
  radioMarkedDayKeys: [],
}

/** Должность из листа Users (G) → правила смен в календаре табеля. */
export function timesheetShiftModeFromPosition(positionRaw: string): TimesheetShiftMode {
  const p = positionRaw.trim()
  if (p === 'Кальянщик')
    return 'hookah'
  if (p === 'Ранер' || p === 'Официант')
    return 'runner_waiter'
  if (p === 'Повар')
    return 'cook'
  return 'default'
}

/** Следующий уровень черновика по клику; `undefined` — убрать отметку с дня. */
export function advanceTimesheetDraftTier(
  current: TimesheetTier | undefined,
  mode: TimesheetShiftMode,
): TimesheetTier | undefined {
  const m = mode === 'default' ? 'hookah' : mode
  if (m === 'runner_waiter') {
    if (current === undefined)
      return 1
    return undefined
  }
  if (m === 'hookah') {
    if (current === undefined)
      return 1
    if (current === 1)
      return 2
    return undefined
  }
  // cook
  if (current === undefined)
    return 1
  if (current === 1)
    return 2
  if (current === 2)
    return 3
  return undefined
}

export function parseTimesheetMonthKeysJsonCell(raw: string): TimesheetMonthKeysJson {
  const t = raw.trim()
  if (!t)
    return { ...EMPTY_TIMESHEET_MONTH_JSON }
  try {
    const parsed = JSON.parse(t) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ...EMPTY_TIMESHEET_MONTH_JSON }
    const o = parsed as { yellowKeys?: unknown, blueKeys?: unknown, orangeKeys?: unknown }
    const yellowKeys = Array.isArray(o.yellowKeys)
      ? o.yellowKeys.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : []
    const blueKeys = Array.isArray(o.blueKeys)
      ? o.blueKeys.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : []
    const orangeKeys = Array.isArray(o.orangeKeys)
      ? o.orangeKeys.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : []
    return { yellowKeys, blueKeys, orangeKeys }
  }
  catch {
    return { ...EMPTY_TIMESHEET_MONTH_JSON }
  }
}

export async function readJsonCalendarTimesheetColumnE(
  ctx: Context,
  sheetRow: number,
): Promise<TimesheetMonthKeysJson | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!E${sheetRow}`)
    return parseTimesheetMonthKeysJsonCell(String(vals[0]?.[0] ?? ''))
  }
  catch {
    return null
  }
}

export async function writeJsonCalendarTimesheetColumnE(
  ctx: Context,
  sheetRow: number,
  payload: TimesheetMonthKeysJson,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!E${sheetRow}`,
    [[JSON.stringify(payload)]],
    'RAW',
  )
}

export async function clearJsonCalendarTimesheetColumnE(
  ctx: Context,
  sheetRow: number,
): Promise<void> {
  await writeJsonCalendarTimesheetColumnE(ctx, sheetRow, { ...EMPTY_TIMESHEET_MONTH_JSON })
}

export function parseTimesheetApprovedFrozenJsonCell(raw: string): TimesheetApprovedFrozenSnapshotJson {
  const t = raw.trim()
  if (!t)
    return { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }
  try {
    const parsed = JSON.parse(t) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }
    const o = parsed as Record<string, unknown>
    const arr = (key: string): string[] =>
      Array.isArray(o[key])
        ? (o[key] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        : []
    return {
      checkMarkedDayKeys: arr('checkMarkedDayKeys'),
      ballotMarkedDayKeys: arr('ballotMarkedDayKeys'),
      radioMarkedDayKeys: arr('radioMarkedDayKeys'),
    }
  }
  catch {
    return { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }
  }
}

export function stripMonthKeysFromApprovedFrozenSnapshot(
  payload: TimesheetApprovedFrozenSnapshotJson,
  y: number,
  m: number,
): TimesheetApprovedFrozenSnapshotJson {
  const inMonth = (k: string) => {
    const p = parseTimesheetDayKey(k)
    return p && p.y === y && p.m === m
  }
  return {
    checkMarkedDayKeys: payload.checkMarkedDayKeys.filter(k => !inMonth(k)),
    ballotMarkedDayKeys: payload.ballotMarkedDayKeys.filter(k => !inMonth(k)),
    radioMarkedDayKeys: payload.radioMarkedDayKeys.filter(k => !inMonth(k)),
  }
}

export function approvedFrozenSnapshotFromMonthKeysJson(
  e: TimesheetMonthKeysJson,
  y: number,
  m: number,
): TimesheetApprovedFrozenSnapshotJson {
  const inMonth = (k: string) => {
    const p = parseTimesheetDayKey(k)
    return p && p.y === y && p.m === m
  }
  return {
    checkMarkedDayKeys: e.yellowKeys.filter(inMonth),
    ballotMarkedDayKeys: e.blueKeys.filter(inMonth),
    radioMarkedDayKeys: e.orangeKeys.filter(inMonth),
  }
}

export function mergeApprovedFrozenSnapshotReplaceMonth(
  existing: TimesheetApprovedFrozenSnapshotJson,
  monthSnap: TimesheetApprovedFrozenSnapshotJson,
  y: number,
  m: number,
): TimesheetApprovedFrozenSnapshotJson {
  const base = stripMonthKeysFromApprovedFrozenSnapshot(existing, y, m)
  return {
    checkMarkedDayKeys: [...base.checkMarkedDayKeys, ...monthSnap.checkMarkedDayKeys],
    ballotMarkedDayKeys: [...base.ballotMarkedDayKeys, ...monthSnap.ballotMarkedDayKeys],
    radioMarkedDayKeys: [...base.radioMarkedDayKeys, ...monthSnap.radioMarkedDayKeys],
  }
}

export function tiersFromApprovedFrozenSnapshot(
  payload: TimesheetApprovedFrozenSnapshotJson,
  y: number,
  m: number,
): Record<string, TimesheetTier> {
  const out: Record<string, TimesheetTier> = {}
  for (const k of payload.checkMarkedDayKeys) {
    const p = parseTimesheetDayKey(k)
    if (p && p.y === y && p.m === m)
      out[k] = 1
  }
  for (const k of payload.ballotMarkedDayKeys) {
    const p = parseTimesheetDayKey(k)
    if (p && p.y === y && p.m === m)
      out[k] = 2
  }
  for (const k of payload.radioMarkedDayKeys) {
    const p = parseTimesheetDayKey(k)
    if (p && p.y === y && p.m === m)
      out[k] = 3
  }
  return out
}

/** Все ключи из F (одобренный табель) → уровень 1/2/3 для календаря запроса зарплаты. */
export function payrollEligibleTierByKeyFromFrozenF(
  payload: TimesheetApprovedFrozenSnapshotJson,
): Record<string, TimesheetTier> {
  const out: Record<string, TimesheetTier> = {}
  for (const k of payload.checkMarkedDayKeys)
    out[k] = 1
  for (const k of payload.ballotMarkedDayKeys)
    out[k] = 2
  for (const k of payload.radioMarkedDayKeys)
    out[k] = 3
  return out
}

export async function readJsonCalendarTimesheetColumnF(
  ctx: Context,
  sheetRow: number,
): Promise<TimesheetApprovedFrozenSnapshotJson | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!F${sheetRow}`)
    return parseTimesheetApprovedFrozenJsonCell(String(vals[0]?.[0] ?? ''))
  }
  catch {
    return null
  }
}

export async function writeJsonCalendarTimesheetColumnF(
  ctx: Context,
  sheetRow: number,
  payload: TimesheetApprovedFrozenSnapshotJson,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!F${sheetRow}`,
    [[JSON.stringify(payload)]],
    'RAW',
  )
}

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
    orangeKeys: payload.orangeKeys.filter(k => !inMonth(k)),
  }
}

/** Ключи дней из E для указанного месяца → уровни (оранжевый перезаписывает жёлтый/синий). */
export function tiersFromTimesheetMonthJsonBucket(
  payload: TimesheetMonthKeysJson,
  y: number,
  m: number,
): Record<string, TimesheetTier> {
  const out: Record<string, TimesheetTier> = {}
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
  for (const k of payload.orangeKeys) {
    const p = parseTimesheetDayKey(k)
    if (p && p.y === y && p.m === m)
      out[k] = 3
  }
  return out
}

export function buildTimesheetJsonEPayload(
  merged: Record<string, TimesheetTier>,
  now: Date,
): TimesheetMonthKeysJson {
  const { min } = timesheetCalendarMinMaxMonth(now)
  const bucket: TimesheetMonthKeysJson = { yellowKeys: [], blueKeys: [], orangeKeys: [] }
  for (const [k, tier] of Object.entries(merged)) {
    const p = parseTimesheetDayKey(k)
    if (!p || p.y !== min.y || p.m !== min.m)
      continue
    if (tier === 1)
      bucket.yellowKeys.push(k)
    else if (tier === 2)
      bucket.blueKeys.push(k)
    else
      bucket.orangeKeys.push(k)
  }
  return bucket
}

function monthHasAnyKey(
  merged: Record<string, TimesheetTier>,
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

/** Колонки A–B строки табеля: месяц (подпись) и ник. */
export async function readTimesheetMonthLabelAndNickForRow(
  ctx: Context,
  sheetRow: number,
): Promise<{ monthLabel: string, nick: string } | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!A${sheetRow}:B${sheetRow}`)
    const monthLabel = String(vals[0]?.[0] ?? '').trim()
    const nick = String(vals[0]?.[1] ?? '').trim()
    if (!monthLabel || !nick)
      return null
    return { monthLabel, nick }
  }
  catch {
    return null
  }
}

/** Д — дневная (жёлтый), В — вечерняя (синий), ДВ — обе смены в день; D:AH = дни 1–31. */
export async function writeTimesheetDayCellsForMonth(
  ctx: Context,
  sheetRow: number,
  year: number,
  month0: number,
  tierByKey: Record<string, TimesheetTier>,
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
    else if (t === 3)
      cells.push('ДВ')
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

/**
 * Сумма в рублях по D:AH для месяца: Д → дневная ставка, В → вечерняя, ДВ → обе (Users E+F).
 */
export function computeTimesheetMonthTotalRub(
  year: number,
  month0: number,
  tierByKey: Record<string, TimesheetTier>,
  dayRate: number,
  eveningRate: number,
): { total: number, hasAnyShift: boolean } {
  const dim = new Date(year, month0 + 1, 0).getDate()
  let total = 0
  let hasAnyShift = false
  for (let day = 1; day <= dim; day++) {
    const k = `${year}-${month0}-${day}`
    const t = tierByKey[k]
    if (t === 1) {
      total += dayRate
      hasAnyShift = true
    }
    else if (t === 2) {
      total += eveningRate
      hasAnyShift = true
    }
    else if (t === 3) {
      total += dayRate + eveningRate
      hasAnyShift = true
    }
  }
  return { total, hasAnyShift }
}

/** Записывает AJ: итог за месяц по ставкам E/F Users или пусто, если смен нет. */
export async function writeTimesheetAjMonthTotalForUserRow(
  ctx: Context,
  timesheetSheetRow: number,
  year: number,
  month0: number,
  tierByKey: Record<string, TimesheetTier>,
  normalizedUsername: string,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')

  const userHit = await findUsersPayrollRowByUsername(ctx, normalizedUsername)
  const dayRate = parseSheetNumericCell(userHit?.row[USERS_TIMESHEET_DAY_RATE_INDEX]) ?? 0
  const eveningRate = parseSheetNumericCell(userHit?.row[USERS_TIMESHEET_EVENING_RATE_INDEX]) ?? 0

  const { total, hasAnyShift } = computeTimesheetMonthTotalRub(
    year,
    month0,
    tierByKey,
    dayRate,
    eveningRate,
  )

  const { sheetName } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  const cellValue = hasAnyShift ? String(Math.round(total * 100) / 100) : ''
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!AJ${timesheetSheetRow}`,
    [[cellValue]],
    'USER_ENTERED',
  )
}

export function timesheetMonthsToWriteRowsFor(
  merged: Record<string, TimesheetTier>,
  now: Date,
): { y: number, m: number }[] {
  const { min } = timesheetCalendarMinMaxMonth(now)
  const out: { y: number, m: number }[] = []
  if (monthHasAnyKey(merged, min.y, min.m))
    out.push({ y: min.y, m: min.m })
  return out
}

/** Очистить D:AH на строке текущего месяца (Aqtobe) для пользователя, если строка есть. */
export async function clearTimesheetDayCellsForUserCurrentMonth(
  ctx: Context,
  normalizedUsername: string,
  now: Date = new Date(),
): Promise<void> {
  const { min } = timesheetCalendarMinMaxMonth(now)
  const label = monthLabelRuFromParts(min.y, min.m)
  const row = await findTimesheetRowByMonthLabelAndUsername(ctx, label, normalizedUsername)
  if (row !== null) {
    await writeTimesheetDayCellsForMonth(ctx, row, min.y, min.m, {})
    await writeTimesheetAjMonthTotalForUserRow(ctx, row, min.y, min.m, {}, normalizedUsername)
  }
}
