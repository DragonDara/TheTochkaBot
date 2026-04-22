import type { IikoOlapReportResponse } from '#root/integrations/iiko-cloud.js'
import type { SheetsRepo } from '#root/repos/sheets-repo.js'
import {
  a1SheetPrefix,
  parseFirstDataRowFromRange,
  parseSheetNameFromRange,
} from '#root/bot/helpers/json-calendar-sheet.js'

const DEFAULT_IIKO_OLAP_SHEET = 'iiko OLAP'
const DEFAULT_IIKO_OLAP_START_ROW = 2

export interface IikoOlapSheetDeps {
  sheetsRepo: SheetsRepo
  spreadsheetId: string
  range: string
  // то, что раньше лежало в ctx.config.sheetsIikoOlapRange
}

function resolveIikoOlapSheetLocation(range: string): { sheetName: string, startRow: number } {
  const trimmed = range.trim()
  if (!trimmed || !trimmed.includes('!'))
    return { sheetName: DEFAULT_IIKO_OLAP_SHEET, startRow: DEFAULT_IIKO_OLAP_START_ROW }
  return {
    sheetName: parseSheetNameFromRange(trimmed),
    startRow: parseFirstDataRowFromRange(trimmed),
  }
}

/** Безопасное приведение значения OLAP к ячейке таблицы. */
function toCell(value: unknown): string {
  if (value === null || value === undefined)
    return ''
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value === 'string')
    return value
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

/** Стабильный порядок колонок: из опций или по ключам первой строки. */
function resolveColumns(
  rows: Array<Record<string, unknown>>,
  explicit?: string[],
): string[] {
  if (explicit && explicit.length > 0)
    return explicit
  if (rows.length === 0)
    return []
  return Object.keys(rows[0])
}

/** Превратить ответ OLAP в матрицу string[][] с заголовком. */
export function olapReportToSheetMatrix(
  report: IikoOlapReportResponse,
  options?: { columns?: string[], includeSummary?: boolean },
): string[][] {
  const columns = resolveColumns(report.data, options?.columns)
  const header = [...columns]
  const dataRows = report.data.map(row => columns.map(col => toCell(row[col])))

  if (!options?.includeSummary || !report.summary)
    return [header, ...dataRows]

  const summaryRow = columns.map(col => toCell(report.summary?.[col]))
  return [header, ...dataRows, summaryRow]
}

/** Очистить весь блок данных на листе OLAP (шапка + строки). */
export async function clearIikoOlapSheet(deps: IikoOlapSheetDeps): Promise<void> {
  const spreadsheetId = deps.spreadsheetId.trim()
  if (!spreadsheetId)
    return
  const { sheetName, startRow } = resolveIikoOlapSheetLocation(deps.range)
  const prefix = a1SheetPrefix(sheetName)

  // Чистим заголовок и все строки ниже (широкий диапазон).
  await deps.sheetsRepo.clearRange(spreadsheetId, `${prefix}!A${startRow - 1}:ZZ`)
}

/** Перезаписать весь лист OLAP: сначала clear, затем writeRange матрицей. */
export async function writeIikoOlapReport(
  deps: IikoOlapSheetDeps,
  report: IikoOlapReportResponse,
  options?: { columns?: string[], includeSummary?: boolean },
): Promise<{ rowsWritten: number }> {
  const spreadsheetId = deps.spreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')

  const { sheetName, startRow } = resolveIikoOlapSheetLocation(deps.range)
  const prefix = a1SheetPrefix(sheetName)

  const matrix = olapReportToSheetMatrix(report, options)
  if (matrix.length === 0)
    return { rowsWritten: 0 }

  await clearIikoOlapSheet(deps)

  // Пишем с startRow-1, чтобы первая строка матрицы попала в шапку листа.
  const firstRow = startRow - 1 <= 0 ? 1 : startRow - 1
  const lastRow = firstRow + matrix.length - 1
  const range = `${prefix}!A${firstRow}:ZZ${lastRow}`

  await deps.sheetsRepo.writeRange(spreadsheetId, range, matrix, 'USER_ENTERED')
  return { rowsWritten: matrix.length }
}
