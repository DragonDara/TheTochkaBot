import type { Context } from '#root/bot/context.js'
import { usernameInList } from '#root/bot/helpers/telegram-usernames.js'

export function isAdmin(ctx: Context) {
  return usernameInList(ctx.from?.username, ctx.config.botAdmins)
}
