import type { Context } from '#root/bot/context.js'
import { a1SheetPrefix, resolveJsonCalendarSheetLocation } from '#root/bot/helpers/json-calendar-sheet.js'

/** Решение по зарплате (колонка D листа JSON Calendar). */
export type PayrollSettlementColumnD =
  | { kind: 'approved', paidGreenKeys: string[] }
  | { kind: 'rejected', rejectedGreenKeysToNumbers: string[] }

export interface JsonCalendarColumnDPayload {
  payrollSettlement?: PayrollSettlementColumnD
}

function parsePayrollSettlement(raw: unknown): PayrollSettlementColumnD | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return undefined
  const o = raw as { kind?: unknown }
  if (o.kind === 'approved') {
    const pg = (raw as { paidGreenKeys?: unknown }).paidGreenKeys
    return {
      kind: 'approved',
      paidGreenKeys: Array.isArray(pg)
        ? pg.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
        : [],
    }
  }
  if (o.kind === 'rejected') {
    const rg = (raw as { rejectedGreenKeysToNumbers?: unknown }).rejectedGreenKeysToNumbers
    return {
      kind: 'rejected',
      rejectedGreenKeysToNumbers: Array.isArray(rg)
        ? rg.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
        : [],
    }
  }
  return undefined
}

export async function readUserCalendarColumnD(
  ctx: Context,
  sheetRow: number,
): Promise<JsonCalendarColumnDPayload | null> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    return null
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const cell = `${prefix}!D${sheetRow}`
  try {
    const vals = await ctx.sheetsRepo.readRange(spreadsheetId, cell)
    const raw = String(vals[0]?.[0] ?? '').trim()
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null
    const ps = parsePayrollSettlement((parsed as { payrollSettlement?: unknown }).payrollSettlement)
    if (!ps)
      return null
    return { payrollSettlement: ps }
  }
  catch {
    return null
  }
}

export async function writeUserCalendarColumnD(
  ctx: Context,
  sheetRow: number,
  payload: JsonCalendarColumnDPayload,
): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const cell = `${prefix}!D${sheetRow}`
  await ctx.sheetsRepo.writeRange(spreadsheetId, cell, [[JSON.stringify(payload)]], 'RAW')
}

export async function clearUserCalendarColumnD(ctx: Context, sheetRow: number): Promise<void> {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId)
    throw new Error('No spreadsheet id')
  const { sheetName } = resolveJsonCalendarSheetLocation(ctx.config.sheetsJsonCalendarRange)
  const prefix = a1SheetPrefix(sheetName)
  const cell = `${prefix}!D${sheetRow}`
  await ctx.sheetsRepo.writeRange(spreadsheetId, cell, [['']], 'RAW')
}

export function buildJsonCalendarColumnDAfterEmployeeDecision(
  approved: boolean,
  requestDayKeys: string[],
): JsonCalendarColumnDPayload {
  return applyPayrollPhDecisionToJsonCalendarD(approved, requestDayKeys, null)
}

function paidKeysFromExisting(existing: JsonCalendarColumnDPayload | null): string[] {
  if (existing?.payrollSettlement?.kind === 'approved')
    return [...existing.payrollSettlement.paidGreenKeys]
  return []
}

/**
 * После решения по одному запросу (ключи дней — колонка K Payment History):
 * **D** всегда `kind: "approved"`: при «Да» добавляем даты запроса в `paidGreenKeys`, при «Нет» — вычитаем.
 * Старые ячейки с `kind: "rejected"` при чтении дают пустой paid; дальше живём только в approved.
 */
export function applyPayrollPhDecisionToJsonCalendarD(
  approved: boolean,
  requestKeys: string[],
  existing: JsonCalendarColumnDPayload | null,
): JsonCalendarColumnDPayload {
  const keys = [...new Set(requestKeys.filter(k => typeof k === 'string' && k.trim() !== ''))]
  let paid = paidKeysFromExisting(existing)

  if (approved) {
    paid = [...new Set([...paid, ...keys])]
  }
  else if (keys.length > 0) {
    const remove = new Set(keys)
    paid = paid.filter(k => !remove.has(k))
  }

  return {
    payrollSettlement: {
      kind: 'approved',
      paidGreenKeys: paid,
    },
  }
}
