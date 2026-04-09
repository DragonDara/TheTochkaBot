import type { Context } from '#root/bot/context.js'
import {
  findUsersPayrollRowByUsername,
  isUsersSheetAccountantRow,
} from '#root/bot/helpers/payroll-users-sheet.js'
import { usernameForSheetMatching } from '#root/bot/helpers/telegram-usernames.js'

/** Сотрудник (меню одобрения): строка Users с H = «Бухгалтер» и тем же @username, что у отправителя. */
export async function isEmployee(ctx: Context): Promise<boolean> {
  const sheetUser = usernameForSheetMatching(ctx)
  if (!sheetUser || !ctx.config.sheetsSpreadsheetId.trim())
    return false
  const hit = await findUsersPayrollRowByUsername(ctx, sheetUser)
  return hit != null && isUsersSheetAccountantRow(hit.row)
}
