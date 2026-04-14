import type { Context } from '#root/bot/context.js'
import {
  a1SheetPrefix,
  parseFirstDataRowFromRange,
  parseSheetNameFromRange,
} from '#root/bot/helpers/json-calendar-sheet.js'
import { usersPayrollSheetPrefix } from '#root/bot/helpers/payroll-users-sheet.js'

const RU_MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const

const TIME_ZONE = 'Asia/Aqtobe'

function aqtobeCalendarParts(d: Date): { y: number, m0: number, day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal')
      map[p.type] = p.value
  }
  return {
    y: Number(map.year),
    m0: Number(map.month) - 1,
    day: Number(map.day),
  }
}

function monthKeyFromYMonth(y: number, m0: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}`
}

export function monthLabelRuFromParts(y: number, m0: number): string {
  return `${RU_MONTHS[m0] ?? RU_MONTHS[0]} ${y}`
}

function monthKeyFromRuLabel(label: string): string | null {
  const t = label.trim()
  const re = /^(\S+)\s+(\d{4})$/
  const m = re.exec(t)
  if (!m)
    return null
  const y = Number(m[2])
  const name = m[1]!.trim()
  const idx = RU_MONTHS.indexOf(name as (typeof RU_MONTHS)[number])
  if (!Number.isFinite(y) || idx < 0)
    return null
  return monthKeyFromYMonth(y, idx)
}

export function formatRequestTimestampRu(d: Date): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal')
      map[p.type] = p.value
  }
  const dd = map.day ?? '01'
  const mm = map.month ?? '01'
  const yy = map.year ?? '1970'
  const hh = map.hour ?? '00'
  const mi = map.minute ?? '00'
  const ss = map.second ?? '00'
  return `${dd}.${mm}.${yy} ${hh}:${mi}:${ss}`
}

function parseDayKeyToUtcNoon(key: string): Date | null {
  const p = key.split('-').map(Number)
  if (p.length !== 3 || !p.every(n => Number.isFinite(n)))
    return null
  const [y, mo, d] = p
  return new Date(Date.UTC(y, mo, d, 12, 0, 0))
}

const UTC_DAY_MS = 24 * 60 * 60 * 1000

function formatUtcDayDdMmYyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = d.getUTCFullYear()
  return `${dd}.${mm}.${yy}`
}

/**
 * Период по ключам `y-m-d` (месяц как в JS, 0-based): непрерывные отрезки — «dd.mm.yyyy - dd.mm.yyyy»,
 * одиночные дни — «dd.mm.yyyy», группы через запятую с пробелом.
 * Пример: «20.03.2026 - 21.03.2026, 25.03.2026, 31.03.2026 - 06.04.2026».
 */
export function periodRangeTextFromDayKeys(keys: string[]): string {
  const dates = [...new Set(keys)]
    .map(parseDayKeyToUtcNoon)
    .filter((x): x is Date => x !== null)
    .sort((a, b) => a.getTime() - b.getTime())
  if (dates.length === 0)
    return '-'

  const parts: string[] = []
  let runStart = dates[0]!
  let runEnd = dates[0]!

  for (let i = 1; i < dates.length; i++) {
    const d = dates[i]!
    if (d.getTime() - runEnd.getTime() === UTC_DAY_MS) {
      runEnd = d
    }
    else {
      parts.push(
        runStart.getTime() === runEnd.getTime()
          ? formatUtcDayDdMmYyyy(runStart)
          : `${formatUtcDayDdMmYyyy(runStart)} - ${formatUtcDayDdMmYyyy(runEnd)}`,
      )
      runStart = runEnd = d
    }
  }
  parts.push(
    runStart.getTime() === runEnd.getTime()
      ? formatUtcDayDdMmYyyy(runStart)
      : `${formatUtcDayDdMmYyyy(runStart)} - ${formatUtcDayDdMmYyyy(runEnd)}`,
  )

  return parts.join(', ')
}

/**
 * 7 календарных дней по Asia/Aqtobe, **оканчиваясь вчера** (вчера — последний день окна).
 * Ключи «y-m-d» как в календаре пользователя.
 */
export function weekDayKeysEndingYesterday(requestAt: Date = new Date()): string[] {
  const { y, m0, day } = aqtobeCalendarParts(requestAt)
  const baseToday = Date.UTC(y, m0, day, 12, 0, 0)
  const baseYesterday = baseToday - 24 * 60 * 60 * 1000
  const end = new Date(baseYesterday)
  const ye = end.getUTCFullYear()
  const me = end.getUTCMonth()
  const de = end.getUTCDate()
  const keys: string[] = []
  for (let delta = 6; delta >= 0; delta--) {
    const d = new Date(Date.UTC(ye, me, de, 12, 0, 0) - delta * 24 * 60 * 60 * 1000)
    keys.push(`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`)
  }
  return keys
}

/** Месяц/год для столбца A — по дате/времени запроса (календарь Asia/Aqtobe, как столбец E). */
export function monthKeyAndLabelFromRequestDate(d: Date): { monthKey: string, monthLabel: string } {
  const { y, m0 } = aqtobeCalendarParts(d)
  return { monthKey: monthKeyFromYMonth(y, m0), monthLabel: monthLabelRuFromParts(y, m0) }
}

function paymentHistoryLocation(ctx: Context): { sheetName: string, startRow: number, prefix: string } {
  const range = ctx.config.sheetsPaymentHistoryRange.trim()
  const sheetName = parseSheetNameFromRange(range.includes('!') ? range : '\'Payment History\'!A2:K')
  const startRow = range.includes('!') ? parseFirstDataRowFromRange(range) : 2
  return { sheetName, startRow, prefix: a1SheetPrefix(sheetName) }
}

/** Колонка F листа Payment History — текст периода запроса (как при записи из `appendSalaryPaymentHistoryRow`). */
export async function readPaymentHistoryPeriodCellF(ctx: Context, sheetRow: number): Promise<string> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return ''
  const { prefix } = paymentHistoryLocation(ctx)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!F${sheetRow}`)
    return String(vals[0]?.[0] ?? '').trim()
  }
  catch {
    return ''
  }
}

export function normalizePayrollStatusCell(s: string): string {
  return s.trim().toLowerCase()
}

function paymentHistoryBSliceRowLooksLikeData(row: string[] | undefined): boolean {
  if (!row?.length)
    return false
  return row.some(c => String(c ?? '').trim() !== '')
}

export function parseSheetNumericCell(s: string | undefined): number | null {
  const raw = String(s ?? '').trim()
  if (raw === '')
    return null
  /** UNFORMATTED_VALUE даёт «чистое» число; FORMATTED может дать «1 234 ₽» — убираем всё кроме цифр и разделителей. */
  let t = raw.replace(/\s/g, '').replace(/[^\d.,-]/g, '')
  if (t === '' || t === '-')
    return null
  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  if (lastComma > lastDot)
    t = t.replace(/\./g, '').replace(',', '.')
  else if (lastDot > lastComma)
    t = t.replace(/,/g, '')
  else if (lastComma !== -1 && lastDot === -1)
    t = t.replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function computePayrollRequestAmountFromUsersRow(
  row: string[],
  greenDayCount: number,
): number | null {
  const d = parseSheetNumericCell(row[3])
  const e = parseSheetNumericCell(row[4])
  if (d === null || e === null || d === 0)
    return null
  return (e / d) * greenDayCount
}

function formatAmountForPaymentHistoryCell(amount: number): string {
  return String(Math.round(amount * 100) / 100)
}

/**
 * Нижняя строка листа Payment History со статусом «Запрошена», с тем же ФИО (кол. C), что на строке Users.
 */
export async function findLatestPendingPaymentHistoryRowForUsersSheetRow(
  ctx: Context,
  usersSheetRow: number,
): Promise<number | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null

  const usersPrefix = usersPayrollSheetPrefix(ctx)
  let userRowVals: string[][]
  try {
    userRowVals = await ctx.sheetsRepo.readRange(
      spreadsheetId,
      `${usersPrefix}!B${usersSheetRow}:B${usersSheetRow}`,
    )
  }
  catch {
    return null
  }
  const fio = String(userRowVals[0]?.[0] ?? '').trim()
  if (!fio)
    return null

  const { startRow, prefix } = paymentHistoryLocation(ctx)
  const readRange = `${prefix}!B${startRow}:K${startRow + 4999}`
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(spreadsheetId, readRange)
  }
  catch {
    return null
  }

  let bestFioOnly: number | null = null
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (!paymentHistoryBSliceRowLooksLikeData(r))
      continue
    const rowFio = String(r?.[1] ?? '').trim()
    const rowStatus = String(r?.[6] ?? '').trim()
    if (normalizePayrollStatusCell(rowStatus) !== 'запрошена')
      continue
    if (rowFio !== fio)
      continue
    if (bestFioOnly === null)
      bestFioOnly = startRow + i
  }

  return bestFioOnly
}

/**
 * Меняет H на листе Payment History на `newStatus` только если там сейчас «Запрошена».
 */
export interface PaymentHistoryApprovalListItem {
  sheetRow: number
  fio: string
  position: string
  requestedPeriod: string
  requestedSum: string
}

function cellOrQuestion(s: string | undefined): string {
  const t = String(s ?? '').trim()
  return t || '?'
}

/** Ключ текущего месяца (Asia/Aqtobe) в формате `YYYY-MM`, как у подписи месяца в колонке A. */
export function monthKeyNowAqtobe(): string {
  const { y, m0 } = aqtobeCalendarParts(new Date())
  return monthKeyFromYMonth(y, m0)
}

/**
 * Строки листа Payment History: статус «Запрошена», блок месяца по колонке A = текущий календарный месяц.
 */
export async function listPaymentHistoryPendingApprovalCurrentMonth(
  ctx: Context,
): Promise<PaymentHistoryApprovalListItem[]> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return []

  const { startRow, prefix } = paymentHistoryLocation(ctx)
  const readRange = `${prefix}!A${startRow}:K${startRow + 4999}`
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(spreadsheetId, readRange)
  }
  catch {
    throw new Error('read payment history')
  }

  const currentKey = monthKeyNowAqtobe()
  const out: PaymentHistoryApprovalListItem[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!rowHasDataBThroughK(row))
      continue
    const bStart = blockStartIndex(rows, i)
    const monthLabel = String(rows[bStart]?.[0] ?? '').trim()
    const blockMonthKey = monthKeyFromRuLabel(monthLabel)
    if (blockMonthKey === null || blockMonthKey !== currentKey)
      continue
    const status = String(row[7] ?? '').trim()
    if (normalizePayrollStatusCell(status) !== 'запрошена')
      continue
    out.push({
      sheetRow: startRow + i,
      fio: cellOrQuestion(row[2]),
      position: cellOrQuestion(row[3]),
      requestedPeriod: cellOrQuestion(row[5]),
      requestedSum: cellOrQuestion(row[6]),
    })
  }
  return out
}

/** Одна строка B:K: B–H как раньше; I и J пустые в данных бота; K — JSON ключей дней запроса. */
export async function readPaymentHistoryRowBtoK(
  ctx: Context,
  sheetRow: number,
): Promise<string[] | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { prefix } = paymentHistoryLocation(ctx)
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, `${prefix}!B${sheetRow}:K${sheetRow}`)
    return vals[0] ?? null
  }
  catch {
    return null
  }
}

/** Совместимость: то же, что {@link readPaymentHistoryRowBtoK}. */
export const readPaymentHistoryRowBtoH = readPaymentHistoryRowBtoK

/** Парсинг колонки K: массив ключей дней `y-m-d`. */
export function parsePaymentHistoryRequestGreenDayKeys(raw: string | undefined): string[] {
  const t = String(raw ?? '').trim()
  if (!t)
    return []
  try {
    const parsed = JSON.parse(t) as unknown
    if (!Array.isArray(parsed))
      return []
    return parsed.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
  }
  catch {
    return []
  }
}

function formatPaymentHistoryRequestGreenDayKeysCell(keys: string[]): string {
  return JSON.stringify(keys)
}

export async function updatePaymentHistoryStatusIfRequested(
  ctx: Context,
  paymentHistorySheetRow: number,
  newStatus: 'Одобрена' | 'Не одобрена',
): Promise<boolean> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return false

  const { prefix } = paymentHistoryLocation(ctx)
  const cellH = `${prefix}!H${paymentHistorySheetRow}`
  let vals: string[][]
  try {
    vals = await ctx.sheetsRepo.readRange(spreadsheetId, cellH)
  }
  catch {
    return false
  }
  const cur = String(vals[0]?.[0] ?? '').trim()
  if (normalizePayrollStatusCell(cur) !== 'запрошена')
    return false

  await ctx.sheetsRepo.writeRange(spreadsheetId, cellH, [[newStatus]], 'USER_ENTERED')
  return true
}

async function batchUpdate(ctx: Context, body: Parameters<Context['sheetsRepo']['batchUpdate']>[1]): Promise<void> {
  await ctx.sheetsRepo.batchUpdate(ctx.config.sheetsSpreadsheetId.trim(), body)
}

function gridRangeA(
  sheetId: number,
  startSheetRow1: number,
  endSheetRow1Inclusive: number,
): { sheetId: number, startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number } {
  return {
    sheetId,
    startRowIndex: startSheetRow1 - 1,
    endRowIndex: endSheetRow1Inclusive,
    startColumnIndex: 0,
    endColumnIndex: 1,
  }
}

function rowHasDataBThroughK(row: string[] | undefined): boolean {
  if (!row)
    return false
  for (let j = 1; j <= 10; j++) {
    if (String(row[j] ?? '').trim() !== '')
      return true
  }
  return false
}

function lastDataSheetRow(rows: string[][], startRow: number): number {
  let last = startRow - 1
  for (let i = 0; i < rows.length; i++) {
    if (rowHasDataBThroughK(rows[i]))
      last = startRow + i
  }
  return last
}

/** Первая строка блока месяца: у продолжений в A пусто (после merge только верхняя ячейка). */
function blockStartIndex(rows: string[][], iRow: number): number {
  let k = iRow
  while (k > 0 && !String(rows[k]?.[0] ?? '').trim())
    k--
  return k
}

function blockEndIndex(rows: string[][], startIdx: number): number {
  let k = startIdx
  while (k + 1 < rows.length && !String(rows[k + 1]?.[0] ?? '').trim())
    k++
  return k
}

export interface AppendPaymentHistoryInput {
  monthKey: string
  monthLabel: string
  fio: string
  position: string
  requestedAt: Date
  periodText: string
  greenDayCount: number
  /** Ключи дней этого запроса (`y-m-d`) — JSON в колонке K, если {@link writeRequestGreenDayKeysToColumnK} не false. */
  requestGreenDayKeys: string[]
  /** По умолчанию true. Если false — колонка K пустая (поток «табель»). */
  writeRequestGreenDayKeysToColumnK?: boolean
  /** Сумма в колонке G листа Payment History: `(E/D)*greenDayCount` по строке Users, посчитано в коде. */
  requestedAmount: number
  status: string
}

/** Добавить строку истории; возвращает номер строки листа. */
export async function appendSalaryPaymentHistoryRow(
  ctx: Context,
  input: AppendPaymentHistoryInput,
): Promise<number> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')

  const { startRow, prefix, sheetName } = paymentHistoryLocation(ctx)
  const readRange = `${prefix}!A${startRow}:K${startRow + 4999}`
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(spreadsheetId, readRange)
  }
  catch {
    rows = []
  }

  const lastRow = lastDataSheetRow(rows, startRow)
  const newRow = lastRow < startRow ? startRow : lastRow + 1

  let requestNum = 1
  let blockStartSheetRow = newRow
  let extendMonth = false

  if (lastRow >= startRow) {
    const lastIdx = lastRow - startRow
    const bStart = blockStartIndex(rows, lastIdx)
    const bEnd = blockEndIndex(rows, bStart)
    blockStartSheetRow = startRow + bStart
    const label = String(rows[bStart]?.[0] ?? '').trim()
    const blockMonthKey = monthKeyFromRuLabel(label)

    if (blockMonthKey === input.monthKey && lastRow === startRow + bEnd) {
      extendMonth = true
      requestNum = bEnd - bStart + 2
    }
  }

  const e = formatRequestTimestampRu(input.requestedAt)
  const gValue = formatAmountForPaymentHistoryCell(input.requestedAmount)
  const writeK = input.writeRequestGreenDayKeysToColumnK !== false
  const kCell = writeK ? formatPaymentHistoryRequestGreenDayKeysCell(input.requestGreenDayKeys) : ''
  const bToK = [[
    String(requestNum),
    input.fio,
    input.position,
    e,
    input.periodText,
    gValue,
    input.status,
    '',
    '',
    kCell,
  ]]

  await ctx.sheetsRepo.writeRange(
    spreadsheetId,
    `${prefix}!B${newRow}:K${newRow}`,
    bToK,
    'USER_ENTERED',
  )

  const sheetId = await ctx.sheetsRepo.getSheetIdByTitle(spreadsheetId, sheetName)

  if (sheetId === null) {
    if (extendMonth) {
      await ctx.sheetsRepo.writeRange(spreadsheetId, `${prefix}!A${blockStartSheetRow}`, [[input.monthLabel]], 'USER_ENTERED')
      await ctx.sheetsRepo.writeRange(spreadsheetId, `${prefix}!A${newRow}`, [[input.monthLabel]], 'USER_ENTERED')
    }
    else {
      await ctx.sheetsRepo.writeRange(spreadsheetId, `${prefix}!A${newRow}`, [[input.monthLabel]], 'USER_ENTERED')
    }
    return newRow
  }

  if (extendMonth) {
    await batchUpdate(ctx, {
      requests: [
        { unmergeCells: { range: gridRangeA(sheetId, blockStartSheetRow, lastRow) } },
        { mergeCells: { range: gridRangeA(sheetId, blockStartSheetRow, newRow), mergeType: 'MERGE_ALL' } },
      ],
    })
    await ctx.sheetsRepo.writeRange(
      spreadsheetId,
      `${prefix}!A${blockStartSheetRow}`,
      [[input.monthLabel]],
      'USER_ENTERED',
    )
  }
  else {
    await ctx.sheetsRepo.writeRange(
      spreadsheetId,
      `${prefix}!A${newRow}`,
      [[input.monthLabel]],
      'USER_ENTERED',
    )
    await batchUpdate(ctx, {
      requests: [
        { mergeCells: { range: gridRangeA(sheetId, newRow, newRow), mergeType: 'MERGE_ALL' } },
      ],
    })
  }

  return newRow
}

/** Удалить строку истории и восстановить объединение A и нумерацию B в блоке месяца. */
export async function removeSalaryPaymentHistoryRow(ctx: Context, sheetRow: number): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')

  const { startRow, prefix, sheetName } = paymentHistoryLocation(ctx)
  const sheetId = await ctx.sheetsRepo.getSheetIdByTitle(spreadsheetId, sheetName)
  if (sheetId === null)
    return

  const readRange = `${prefix}!A${startRow}:K${startRow + 4999}`
  let rows: string[][]
  try {
    rows = await ctx.sheetsRepo.readRange(spreadsheetId, readRange)
  }
  catch {
    return
  }

  const idx = sheetRow - startRow
  if (idx < 0 || idx >= rows.length || !rowHasDataBThroughK(rows[idx]))
    return

  const bStart = blockStartIndex(rows, idx)
  const bEnd = blockEndIndex(rows, bStart)
  const blockStartSheetRow = startRow + bStart
  const blockEndSheetRow = startRow + bEnd
  const monthLabel = String(rows[bStart]?.[0] ?? '').trim()
  const blockSize = bEnd - bStart + 1

  await batchUpdate(ctx, {
    requests: [
      { unmergeCells: { range: gridRangeA(sheetId, blockStartSheetRow, blockEndSheetRow) } },
    ],
  })

  await batchUpdate(ctx, {
    requests: [{
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: sheetRow - 1,
          endIndex: sheetRow,
        },
      },
    }],
  })

  if (blockSize <= 1)
    return

  const newBlockEnd = blockEndSheetRow - 1

  await batchUpdate(ctx, {
    requests: [
      { mergeCells: { range: gridRangeA(sheetId, blockStartSheetRow, newBlockEnd), mergeType: 'MERGE_ALL' } },
    ],
  })

  if (monthLabel) {
    await ctx.sheetsRepo.writeRange(
      spreadsheetId,
      `${prefix}!A${blockStartSheetRow}`,
      [[monthLabel]],
      'USER_ENTERED',
    )
  }

  const remaining = blockSize - 1
  for (let k = 0; k < remaining; k++) {
    await ctx.sheetsRepo.writeRange(
      spreadsheetId,
      `${prefix}!B${blockStartSheetRow + k}`,
      [[String(k + 1)]],
      'USER_ENTERED',
    )
  }
}

export async function readUsersRequestedSumDisplay(
  ctx: Context,
  usersSheetRow: number,
): Promise<string> {
  const phRow = await findLatestPendingPaymentHistoryRowForUsersSheetRow(ctx, usersSheetRow)
  if (phRow === null)
    return '-'
  const bh = await readPaymentHistoryRowBtoK(ctx, phRow)
  const v = String(bh?.[5] ?? '').trim()
  return v || '-'
}
