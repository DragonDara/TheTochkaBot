import { createCallbackData } from 'callback-data'

/**
 * Как у payroll-calendar, префикс другой — отдельные callback для потока «Табель».
 */
export const timesheetCalendarData = createCallbackData('tcal', {
  a: String,
  m: Number,
  y: Number,
  d: Number,
})
