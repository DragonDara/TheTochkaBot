import type { Context } from '#root/bot/context.js'
import { a1SheetPrefix } from '#root/bot/helpers/json-calendar-sheet.js'
import { usersPayrollPositionByNormalizedUsernameMap } from '#root/bot/helpers/payroll-users-sheet.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'
import { resolveTimesheetSheetLocation } from '#root/bot/helpers/timesheet-sheet.js'

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
