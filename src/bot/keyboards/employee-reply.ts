import type { Context } from '#root/bot/context.js'
import { Keyboard } from 'grammy'

export function createEmployeeReplyKeyboard(ctx: Context) {
  return new Keyboard()
    .text(ctx.t('employee-btn-requested-payrolls'))
    .resized()
    .persistent()
}

export function createEmployeeUserActionsKeyboard(
  ctx: Context,
  options?: { includeWeekRequest?: boolean },
): Keyboard {
  const kb = new Keyboard()
    .text(ctx.t('employee-btn-distribute-save'))
    .text(ctx.t('employee-btn-distribute-reset'))
    .row()
  if (options?.includeWeekRequest)
    kb.text(ctx.t('user-btn-request-week')).row()
  return kb
    .text(ctx.t('employee-btn-back'))
    .resized()
    .persistent()
}
