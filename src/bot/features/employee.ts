import type { Context } from '#root/bot/context.js'
import type { PaymentHistoryApprovalListItem } from '#root/bot/helpers/payment-history-sheet.js'
import {
  parsePayrollApprovalDecision,
  PAYROLL_APPROVAL_CB_NO,
  PAYROLL_APPROVAL_CB_YES,
  payrollApprovalData,
} from '#root/bot/callback-data/payroll-approval.js'
import { isEmployee } from '#root/bot/filters/is-employee.js'
import {
  findJsonCalendarSheetRowForUsername,
  readUsersSheetColumnA,
} from '#root/bot/helpers/json-calendar-sheet.js'
import { logHandle } from '#root/bot/helpers/logging.js'
import {
  listPaymentHistoryPendingApprovalCurrentMonth,
  normalizePayrollStatusCell,
  parsePaymentHistoryRequestGreenDayKeys,
  readPaymentHistoryRowBtoK,
  updatePaymentHistoryStatusIfRequested,
} from '#root/bot/helpers/payment-history-sheet.js'
import {
  readUserCalendarColumnC,
  stripPaidKeysFromUserCalendarColumnC,
  writeUserCalendarColumnC,
} from '#root/bot/helpers/payroll-user-calendar-c.js'
import {
  applyPayrollPhDecisionToJsonCalendarD,
  readUserCalendarColumnD,
  writeUserCalendarColumnD,
} from '#root/bot/helpers/payroll-user-calendar-d.js'
import { findUsersPayrollRowNumberByFio } from '#root/bot/helpers/payroll-users-sheet.js'
import { createEmployeeReplyKeyboard } from '#root/bot/keyboards/employee-reply.js'
import { Composer, InlineKeyboard } from 'grammy'

/** Колонка H в срезе B:K (индекс 6). */
const PH_STATUS_INDEX = 6
/** Колонка K — JSON ключей дней запроса (индекс 9 в срезе B:K). */
const PH_REQUEST_GREEN_DAY_KEYS_INDEX = 9

async function tryStripApprovalInlineKeyboard(ctx: Context) {
  if (!ctx.callbackQuery?.message)
    return
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined })
  }
  catch {
    // уже без клавиатуры или нельзя отредактировать
  }
}

async function sendEmployeeRequestedPayrollsFlow(ctx: Context) {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId) {
    return ctx.reply(ctx.t('employee-requested-payrolls-empty'), {
      reply_markup: createEmployeeReplyKeyboard(ctx),
    })
  }

  const phRange = ctx.config.sheetsPaymentHistoryRange.trim()
  let rows: PaymentHistoryApprovalListItem[]
  try {
    rows = await listPaymentHistoryPendingApprovalCurrentMonth(ctx)
  }
  catch (error) {
    ctx.logger.error({
      err: error,
      spreadsheetId,
      range: phRange,
    }, 'Failed to read Payment History for requested payrolls')

    return ctx.reply(ctx.t('employee-requested-payrolls-read-error', { range: phRange }), {
      reply_markup: createEmployeeReplyKeyboard(ctx),
    })
  }

  if (rows.length === 0) {
    return ctx.reply(ctx.t('employee-requested-payrolls-empty'), {
      reply_markup: createEmployeeReplyKeyboard(ctx),
    })
  }

  for (const r of rows) {
    const keyboard = new InlineKeyboard()
      .text(
        ctx.t('employee-approve-yes'),
        payrollApprovalData.pack({ row: r.sheetRow, value: PAYROLL_APPROVAL_CB_YES }),
      )
      .text(
        ctx.t('employee-approve-no'),
        payrollApprovalData.pack({ row: r.sheetRow, value: PAYROLL_APPROVAL_CB_NO }),
      )

    const text = `${r.fio} - ${r.position}\n${r.requestedPeriod} - ${r.requestedSum}\n${ctx.t('employee-approve-question')}`
    await ctx.reply(text, { reply_markup: keyboard })
  }

  return ctx.reply(ctx.t('employee-requested-payrolls-done'), {
    reply_markup: createEmployeeReplyKeyboard(ctx),
  })
}

const composer = new Composer<Context>()

const feature = composer
  .chatType('private')
  .filter(isEmployee)

feature
  .filter(ctx => ctx.has('message:text') && ctx.message.text === ctx.t('employee-btn-requested-payrolls'))
  .on(
    'message:text',
    logHandle('employee-requested-payrolls'),
    async (ctx) => {
      return sendEmployeeRequestedPayrollsFlow(ctx)
    },
  )

feature.callbackQuery(
  payrollApprovalData.filter(),
  logHandle('employee-payroll-approval'),
  async (ctx) => {
    const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()

    if (!spreadsheetId) {
      await ctx.answerCallbackQuery({
        text: ctx.t('employee-approve-error'),
      })
      return
    }

    const { row: phSheetRow, value: rawCb } = payrollApprovalData.unpack(ctx.callbackQuery.data)
    const decision = parsePayrollApprovalDecision(rawCb)
    if (decision === null) {
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-error') })
      return
    }
    const approved = decision === 'yes'
    const statusRu = approved ? 'Одобрена' : 'Не одобрена'

    const bh = await readPaymentHistoryRowBtoK(ctx, phSheetRow)
    if (!bh) {
      ctx.logger.warn({ phSheetRow }, 'Payment History row not found for approval callback')
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-error') })
      return
    }

    const statusNow = String(bh[PH_STATUS_INDEX] ?? '').trim()
    if (normalizePayrollStatusCell(statusNow) !== 'запрошена') {
      await tryStripApprovalInlineKeyboard(ctx)
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-already-handled') })
      return
    }

    const fioFromPh = String(bh[1] ?? '').trim()
    const usersRow = await findUsersPayrollRowNumberByFio(ctx, fioFromPh)

    try {
      const statusUpdated = await updatePaymentHistoryStatusIfRequested(ctx, phSheetRow, statusRu)
      if (!statusUpdated) {
        await tryStripApprovalInlineKeyboard(ctx)
        await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-already-handled') })
        return
      }

      if (usersRow != null && statusUpdated) {
        try {
          const usernameCell = await readUsersSheetColumnA(ctx, usersRow)
          if (usernameCell) {
            const jsonRow = await findJsonCalendarSheetRowForUsername(ctx, usernameCell)
            if (jsonRow != null) {
              const fromC = await readUserCalendarColumnC(ctx, jsonRow)
              const existingD = await readUserCalendarColumnD(ctx, jsonRow)
              const keysFromPh = parsePaymentHistoryRequestGreenDayKeys(
                bh[PH_REQUEST_GREEN_DAY_KEYS_INDEX],
              )
              const keysForRequest = keysFromPh.length > 0
                ? keysFromPh
                : (fromC?.userGreenDayKeys ?? [])
              const hadPaid
                = existingD?.payrollSettlement?.kind === 'approved'
                  && existingD.payrollSettlement.paidGreenKeys.length > 0
              if (approved && keysForRequest.length === 0 && !hadPaid) {
                ctx.logger.warn(
                  { phSheetRow, jsonRow, fioFromPh },
                  'No day keys for this PH row (empty K and C); column D gets approved with empty paidGreenKeys',
                )
              }
              // D: каждый раз перезаписываем — одобрение добавляет даты запроса в paidGreenKeys, отказ вычитает.
              const columnD = applyPayrollPhDecisionToJsonCalendarD(approved, keysForRequest, existingD)
              await writeUserCalendarColumnD(ctx, jsonRow, columnD)
              // C: после любого решения убираем из userGreenDayKeys только даты этого запроса.
              if (fromC && keysForRequest.length > 0) {
                const stripped = stripPaidKeysFromUserCalendarColumnC(fromC, keysForRequest)
                if (stripped) {
                  try {
                    await writeUserCalendarColumnC(ctx, jsonRow, stripped)
                  }
                  catch (error) {
                    ctx.logger.warn(
                      { err: error, jsonRow },
                      'Failed to sync JSON Calendar column C after payroll decision',
                    )
                  }
                }
              }
            }
          }
        }
        catch (error) {
          ctx.logger.warn(
            { err: error, usersRow, phSheetRow, approved },
            'Failed to write JSON Calendar column D after payroll approval',
          )
        }
      }

      await tryStripApprovalInlineKeyboard(ctx)
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-saved') })
    }
    catch (error) {
      ctx.logger.error({ err: error, spreadsheetId, phSheetRow, approved }, 'Failed to write approval')
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-error') })
    }
  },
)

export { composer as employeeFeature }
