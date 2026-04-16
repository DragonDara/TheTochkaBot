import type { Context } from '#root/bot/context.js'
import { a1SheetPrefix, findJsonCalendarSheetRowForUsername } from '#root/bot/helpers/json-calendar-sheet.js'
import { parseRuMonthLabelToYearMonth0 } from '#root/bot/helpers/payment-history-sheet.js'
import { usersPayrollPositionByNormalizedUsernameMap } from '#root/bot/helpers/payroll-users-sheet.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'
import {
  approvedFrozenSnapshotFromMonthKeysJson,
  EMPTY_TIMESHEET_APPROVED_FROZEN_JSON,
  EMPTY_TIMESHEET_MONTH_JSON,
  mergeApprovedFrozenSnapshotReplaceMonth,
  parseTimesheetYmKey,
  readJsonCalendarTimesheetColumnE,
  readJsonCalendarTimesheetColumnF,
  resolveTimesheetSheetLocation,
  stripMonthKeysFromApprovedFrozenSnapshot,
  timesheetYmKey,
  writeJsonCalendarTimesheetColumnF,
} from '#root/bot/helpers/timesheet-sheet.js'

/** A=0 … AH=33 (31 день), AI=34. */
const COL_AI_INDEX = 34
const COL_D_INDEX = 3
const COL_AH_INDEX = 33

function rowHasAnyDayCellDThroughAh(row: string[]): boolean {
  for (let j = COL_D_INDEX; j <= COL_AH_INDEX; j++) {
    if (String(row[j] ?? '').trim() !== '')
      return true
  }
  return false
}

export function normalizeTimesheetApprovalStatusCell(s: string): 'pending' | 'approved' | 'rejected' {
  const t = s.trim().toLowerCase()
  if (t === 'одобрен')
    return 'approved'
  if (t === 'не одобрен')
    return 'rejected'
  return 'pending'
}

export interface TimesheetPendingApprovalItem {
  sheetRow: number
  fio: string
  /** Должность с листа Users (G), по нику из колонки B табеля. */
  position: string
  monthLabel: string
  requestedDaysText: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function requestedDaysTextFromRow(row: string[], monthLabel: string): string {
  const ym = parseRuMonthLabelToYearMonth0(monthLabel)
  const month = ym ? ym.m0 + 1 : null
  const parts: string[] = []

  for (let j = COL_D_INDEX; j <= COL_AH_INDEX; j++) {
    const raw = String(row[j] ?? '').trim()
    if (!raw)
      continue
    const day = j - COL_D_INDEX + 1
    const dayLabel = month !== null
      ? `${pad2(day)}.${pad2(month)}`
      : String(day)
    parts.push(`${dayLabel} - ${raw}`)
  }

  return parts.join('; ')
}

/**
 * Строки с ФИО и ником, где статус в AI ещё не «Одобрен» / «Не одобрен»,
 * в хотя бы одной ячейке D:AH есть значение, строки 1–2 листа не обрабатываются.
 * Пустой A после merge: месяц подтягивается с предыдущей заполненной ячейки A.
 */
export async function listTimesheetPendingApproval(
  ctx: Context,
): Promise<TimesheetPendingApprovalItem[]> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return []

  const { sheetName, startRow } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(
      spreadsheetId,
      `${prefix}!A${startRow}:AI${startRow + 4999}`,
    )
  }
  catch {
    throw new Error('read timesheet')
  }

  const positionByNick = await usersPayrollPositionByNormalizedUsernameMap(ctx)
  const out: TimesheetPendingApprovalItem[] = []
  let blockMonthLabel = ''
  for (let i = 0; i < rows.length; i++) {
    const sheetRowNumber = startRow + i
    if (sheetRowNumber < 3)
      continue

    const row = rows[i]
    if (!row)
      continue
    if (!rowHasAnyDayCellDThroughAh(row))
      continue
    const a = String(row[0] ?? '').trim()
    if (a)
      blockMonthLabel = a
    const monthLabel = blockMonthLabel
    const fio = String(row[2] ?? '').trim()
    const nick = String(row[1] ?? '').trim()
    if (!monthLabel || !fio || !nick)
      continue
    const statusRaw = String(row[COL_AI_INDEX] ?? '')
    if (normalizeTimesheetApprovalStatusCell(statusRaw) !== 'pending')
      continue
    const nickKey = normalizeTelegramUsername(nick)
    const position = nickKey ? (positionByNick.get(nickKey) ?? '') : ''
    out.push({
      sheetRow: startRow + i,
      fio,
      position,
      monthLabel,
      requestedDaysText: requestedDaysTextFromRow(row, monthLabel),
    })
  }
  return out
}

export async function readTimesheetApprovalStatusCell(
  ctx: Context,
  sheetRow: number,
): Promise<string | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!AI${sheetRow}`)
    return String(vals[0]?.[0] ?? '')
  }
  catch {
    return null
  }
}

/**
 * После /start: по строкам табеля с этим ником сверяет JSON Calendar F с колонкой AI.
 * «Одобрен» в AI (в т.ч. выставлено вручную в таблице) — снимок отметок из E на этот месяц в F;
 * иначе — ключи этого месяца убираются из F.
 */
export async function reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForUser(
  ctx: Context,
  sheetUser: string,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return

  const needle = normalizeTelegramUsername(sheetUser)
  if (!needle)
    return

  const jsonRow = await findJsonCalendarSheetRowForUsername(ctx, sheetUser)
  if (jsonRow === null)
    return

  const ePayload = (await readJsonCalendarTimesheetColumnE(ctx, jsonRow)) ?? { ...EMPTY_TIMESHEET_MONTH_JSON }
  let frozen = (await readJsonCalendarTimesheetColumnF(ctx, jsonRow)) ?? { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }

  const { sheetName, startRow } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(
      spreadsheetId,
      `${prefix}!A${startRow}:AI${startRow + 4999}`,
    )
  }
  catch (error) {
    ctx.logger.warn({ err: error }, 'Failed to read Timesheet for F/AI reconcile')
    return
  }

  /** Ключ месяца `y-m` → последний по порядку строк статус AI для этого пользователя. */
  const normByYm = new Map<string, 'approved' | 'rejected' | 'pending'>()
  let blockMonthLabel = ''
  for (let i = 0; i < rows.length; i++) {
    const sheetRowNumber = startRow + i
    if (sheetRowNumber < 3)
      continue
    const row = rows[i]
    if (!row)
      continue
    const a = String(row[0] ?? '').trim()
    if (a)
      blockMonthLabel = a
    const monthLabel = blockMonthLabel
    const nick = String(row[1] ?? '').trim()
    const fio = String(row[2] ?? '').trim()
    if (!monthLabel || !nick || !fio)
      continue
    if (normalizeTelegramUsername(nick) !== needle)
      continue
    const ymParts = parseRuMonthLabelToYearMonth0(monthLabel)
    if (!ymParts)
      continue
    const statusRaw = String(row[COL_AI_INDEX] ?? '')
    normByYm.set(timesheetYmKey(ymParts.y, ymParts.m0), normalizeTimesheetApprovalStatusCell(statusRaw))
  }

  let changed = false
  for (const [ymKey, norm] of normByYm) {
    const ymParsed = parseTimesheetYmKey(ymKey)
    if (!ymParsed)
      continue
    const { y, m: m0 } = ymParsed
    if (norm === 'approved') {
      const monthSnap = approvedFrozenSnapshotFromMonthKeysJson(ePayload, y, m0)
      const merged = mergeApprovedFrozenSnapshotReplaceMonth(frozen, monthSnap, y, m0)
      if (JSON.stringify(merged) !== JSON.stringify(frozen)) {
        frozen = merged
        changed = true
      }
    }
    else {
      const stripped = stripMonthKeysFromApprovedFrozenSnapshot(frozen, y, m0)
      if (JSON.stringify(stripped) !== JSON.stringify(frozen)) {
        frozen = stripped
        changed = true
      }
    }
  }

  if (!changed)
    return
  try {
    await writeJsonCalendarTimesheetColumnF(ctx, jsonRow, frozen)
  }
  catch (error) {
    ctx.logger.warn({ err: error, jsonRow }, 'Failed to write JSON Calendar F after Timesheet AI reconcile')
  }
}

/** Сверяет JSON Calendar F с AI для всех пользователей, найденных в листе Timesheet. */
export async function reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForAllUsers(
  ctx: Context,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return

  const { sheetName, startRow } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(
      spreadsheetId,
      `${prefix}!A${startRow}:C${startRow + 4999}`,
    )
  }
  catch (error) {
    ctx.logger.warn({ err: error }, 'Failed to read Timesheet usernames for F/AI reconcile')
    return
  }

  const users = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    const sheetRowNumber = startRow + i
    if (sheetRowNumber < 3)
      continue
    const row = rows[i]
    const nick = String(row?.[1] ?? '').trim()
    const fio = String(row?.[2] ?? '').trim()
    const normalized = normalizeTelegramUsername(nick)
    if (!normalized || !fio)
      continue
    users.add(normalized)
  }

  for (const username of users) {
    try {
      await reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForUser(ctx, username)
    }
    catch (error) {
      ctx.logger.warn({ err: error, username }, 'Failed to reconcile JSON Calendar F with Timesheet AI for user')
    }
  }
}

/**
 * Пишет статус в AI только если сейчас «ожидание» (пусто или не финальный статус).
 */
export async function updateTimesheetApprovalStatusIfPending(
  ctx: Context,
  sheetRow: number,
  newStatus: 'Одобрен' | 'Не одобрен',
): Promise<boolean> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return false

  const cur = await readTimesheetApprovalStatusCell(ctx, sheetRow)
  if (cur === null)
    return false
  if (normalizeTimesheetApprovalStatusCell(cur) !== 'pending')
    return false

  const { sheetName } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!AI${sheetRow}`,
    [[newStatus]],
    'USER_ENTERED',
  )
  return true
}

/** Очищает AI (статус одобрения) в строке табеля — после сохранения табеля пользователем. */
export async function clearTimesheetApprovalStatusCell(
  ctx: Context,
  sheetRow: number,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return
  const { sheetName } = resolveTimesheetSheetLocation(ctx.config.sheetsTimesheetRange)
  const prefix = a1SheetPrefix(sheetName)
  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!AI${sheetRow}`,
    [['']],
    'RAW',
  )
}
