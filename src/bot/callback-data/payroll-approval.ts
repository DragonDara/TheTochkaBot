import { createCallbackData } from 'callback-data'

/**
 * В callback_data только ASCII (`y`/`n`): кириллица «Одобрена» ломала сравнение после unpack
 * → в D уходило `rejected` при нажатии «Да». Русские статусы пишутся в Payment History отдельно.
 */
export const PAYROLL_APPROVAL_CB_YES = 'y'
export const PAYROLL_APPROVAL_CB_NO = 'n'

export const payrollApprovalData = createCallbackData('payrollApproval', {
  row: Number,
  value: String,
})

export function parsePayrollApprovalDecision(value: string): 'yes' | 'no' | null {
  const v = value.trim()
  if (v === PAYROLL_APPROVAL_CB_YES || v === '1' || v === 'Одобрена')
    return 'yes'
  if (v === PAYROLL_APPROVAL_CB_NO || v === '0' || v === 'Не одобрена')
    return 'no'
  return null
}
