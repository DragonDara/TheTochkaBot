import { createCallbackData } from 'callback-data'

/**
 * a: p — предыдущий месяц, n — следующий, x — без действия, d — переключить день.
 * d: день месяца (1–31) для ячеек дат; 0 для служебных кнопок.
 */
export const payrollCalendarData = createCallbackData('pcal', {
  a: String,
  m: Number,
  y: Number,
  d: Number,
})
