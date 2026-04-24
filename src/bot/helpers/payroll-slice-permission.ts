import type { Context } from '#root/bot/context.js'
import { isAdmin } from '#root/bot/filters/is-admin.js'
import { listPayrollAccountantUsernamesFromUsersSheet } from '#root/bot/helpers/payroll-users-sheet.js'
import { normalizeTelegramUsername } from '#root/bot/helpers/telegram-usernames.js'

/** Админы из `BOT_ADMINS` либо роль «Бухгалтер» в колонке H листа Users. */
export async function canRunPayrollSliceCommand(ctx: Context): Promise<boolean> {
  if (isAdmin(ctx)) {
    return true
  }
  const u = normalizeTelegramUsername(ctx.from?.username ?? '')
  if (!u) {
    return false
  }
  const accountants = await listPayrollAccountantUsernamesFromUsersSheet(ctx)
  return accountants.some(n => normalizeTelegramUsername(n) === u)
}
