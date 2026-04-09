import type { Context } from '#root/bot/context.js'
import type { LanguageCode } from '@grammyjs/types'
import type { CommandContext } from 'grammy'
import { listPayrollAccountantUsernamesFromUsersSheet } from '#root/bot/helpers/payroll-users-sheet.js'
import { resolveTelegramUsernamesToPrivateChatIds } from '#root/bot/helpers/telegram-usernames.js'
import { i18n } from '#root/bot/i18n.js'
import { Command, CommandGroup } from '@grammyjs/commands'

function addCommandLocalizations(command: Command) {
  i18n.locales.forEach((locale) => {
    command.localize(
      locale as LanguageCode,
      command.name,
      i18n.t(locale, `${command.name}.description`),
    )
  })
  return command
}

function addCommandToChats(command: Command, chats: number[]) {
  for (const chatId of chats) {
    command.addToScope({
      type: 'chat',
      chat_id: chatId,
    })
  }
}

/** Меню сотрудника: команды в личке для строк Users с H = «Бухгалтер» (разрешение @username через getChat). */
export async function buildEmployeeCommandsGroup(
  ctx: Context,
  accountantUsernames: string[],
): Promise<CommandGroup<Context>> {
  const chatIds = await resolveTelegramUsernamesToPrivateChatIds(ctx.api, accountantUsernames)
  if (accountantUsernames.length > 0 && chatIds.length === 0) {
    ctx.logger.warn(
      { accountantUsernames },
      'employee commands menu: failed to resolve any accountant username to chat id',
    )
  }

  const start = new Command('start', i18n.t('en', 'start.description'))
    .addToScope({ type: 'all_private_chats' })
  addCommandLocalizations(start)
  addCommandToChats(start, chatIds)

  const language = new Command('language', i18n.t('en', 'language.description'))
    .addToScope({ type: 'all_private_chats' })
  addCommandLocalizations(language)
  addCommandToChats(language, chatIds)

  return new CommandGroup()
    .add(start)
    .add(language)
}

export async function setCommandsHandler(ctx: CommandContext<Context>) {
  const adminChatIds = await resolveTelegramUsernamesToPrivateChatIds(ctx.api, ctx.config.botAdmins)
  if (ctx.config.botAdmins.length > 0 && adminChatIds.length === 0) {
    ctx.logger.warn(
      { botAdmins: ctx.config.botAdmins },
      'setcommands: failed to resolve admin usernames to chat ids (getChat @username); check nicknames and that each user has started the bot',
    )
  }

  const start = new Command('start', i18n.t('en', 'start.description'))
    .addToScope({ type: 'all_private_chats' })
  addCommandLocalizations(start)
  addCommandToChats(start, adminChatIds)

  const language = new Command('language', i18n.t('en', 'language.description'))
    .addToScope({ type: 'all_private_chats' })
  addCommandLocalizations(language)
  addCommandToChats(language, adminChatIds)

  const setcommands = new Command('setcommands', i18n.t('en', 'setcommands.description'))
  addCommandLocalizations(setcommands)
  addCommandToChats(setcommands, adminChatIds)

  const commands = new CommandGroup()
    .add(start)
    .add(language)
    .add(setcommands)

  await commands.setCommands(ctx)

  const accountantUsernames = await listPayrollAccountantUsernamesFromUsersSheet(ctx)
  if (accountantUsernames.length > 0) {
    const employeeGroup = await buildEmployeeCommandsGroup(ctx, accountantUsernames)
    await employeeGroup.setCommands(ctx)
  }

  return ctx.reply(ctx.t('admin-commands-updated'))
}
