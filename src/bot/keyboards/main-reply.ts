import type { Context } from '#root/bot/context.js'
import { isEmployee } from '#root/bot/filters/is-employee.js'
import { createEmployeeReplyKeyboard } from '#root/bot/keyboards/employee-reply.js'
import { Keyboard } from 'grammy'

export function createMainReplyKeyboard(ctx: Context) {
  return new Keyboard()
    .text(ctx.t('salary-btn-request'))
    .text(ctx.t('timesheet-btn-fill'))
    .resized()
    .persistent()
}

/** Reply-меню после /start и смены языка: для сотрудника — только «Запрошенные зарплаты», иначе пользовательское меню. */
export async function createHomeReplyKeyboard(ctx: Context) {
  return (await isEmployee(ctx)) ? createEmployeeReplyKeyboard(ctx) : createMainReplyKeyboard(ctx)
}
