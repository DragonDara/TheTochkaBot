import { createCallbackData } from 'callback-data'

/** Одобрение строки листа Timesheet: колонка AI. */
export const timesheetApprovalData = createCallbackData('tsheetApr', {
  row: Number,
  value: String,
})
