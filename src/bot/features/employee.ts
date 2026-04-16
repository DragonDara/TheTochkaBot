import type { Context } from '#root/bot/context.js'
import type { PaymentHistoryApprovalListItem } from '#root/bot/helpers/payment-history-sheet.js'
import {
  parsePayrollApprovalDecision,
  PAYROLL_APPROVAL_CB_NO,
  PAYROLL_APPROVAL_CB_YES,
  payrollApprovalData,
} from '#root/bot/callback-data/payroll-approval.js'
import { timesheetApprovalData } from '#root/bot/callback-data/timesheet-approval.js'
import { isEmployee } from '#root/bot/filters/is-employee.js'
import { notifyUserByUsernameText } from '#root/bot/helpers/accountant-notify.js'
import {
  findJsonCalendarSheetRowForUsername,
  readUsersSheetColumnA,
} from '#root/bot/helpers/json-calendar-sheet.js'
import { logHandle } from '#root/bot/helpers/logging.js'
import {
  listPaymentHistoryPendingApprovalCurrentMonth,
  normalizePayrollStatusCell,
  parsePaymentHistoryRequestDayBuckets,
  parseRuMonthLabelToYearMonth0,
  readPaymentHistoryPeriodCellF,
  readPaymentHistoryRowBtoK,
  unionPaymentHistoryRequestDayKeys,
  updatePaymentHistoryStatusIfRequested,
} from '#root/bot/helpers/payment-history-sheet.js'
import {
  emptyUserCalendarColumnCPayload,
  readUserCalendarColumnC,
  stripKeysFromUserCalendarColumnC,
  writeUserCalendarColumnC,
} from '#root/bot/helpers/payroll-user-calendar-c.js'
import {
  applyPayrollPhDecisionToJsonCalendarD,
  readUserCalendarColumnD,
  writeUserCalendarColumnD,
} from '#root/bot/helpers/payroll-user-calendar-d.js'
import {
  emptyPayrollRequestColumnG,
  readUserCalendarColumnG,
  stripPaidKeysFromUserCalendarColumnG,
  unionDayKeysFromPayrollBuckets,
  writeUserCalendarColumnG,
} from '#root/bot/helpers/payroll-user-calendar-g.js'
import { findUsersPayrollRowNumberByFio } from '#root/bot/helpers/payroll-users-sheet.js'
import {
  listTimesheetPendingApproval,
  reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForAllUsers,
  updateTimesheetApprovalStatusIfPending,
} from '#root/bot/helpers/timesheet-approval-sheet.js'
import {
  approvedFrozenSnapshotFromMonthKeysJson,
  EMPTY_TIMESHEET_APPROVED_FROZEN_JSON,
  EMPTY_TIMESHEET_MONTH_JSON,
  mergeApprovedFrozenSnapshotReplaceMonth,
  readJsonCalendarTimesheetColumnE,
  readJsonCalendarTimesheetColumnF,
  readTimesheetMonthLabelAndNickForRow,
  stripMonthKeysFromApprovedFrozenSnapshot,
  writeJsonCalendarTimesheetColumnF,
} from '#root/bot/helpers/timesheet-sheet.js'
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

async function sendEmployeeRequestedTimesheetsFlow(ctx: Context) {
  const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
  if (!spreadsheetId) {
    return ctx.reply(ctx.t('employee-requested-timesheets-empty'), {
      reply_markup: createEmployeeReplyKeyboard(ctx),
    })
  }

  const tsRange = ctx.config.sheetsTimesheetRange.trim()
  let rows: Awaited<ReturnType<typeof listTimesheetPendingApproval>>
  try {
    await reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForAllUsers(ctx)
    rows = await listTimesheetPendingApproval(ctx)
  }
  catch (error) {
    ctx.logger.error({
      err: error,
      spreadsheetId,
      range: tsRange,
    }, 'Failed to read Timesheet for requested timesheets')

    return ctx.reply(ctx.t('employee-requested-timesheets-read-error', { range: tsRange }), {
      reply_markup: createEmployeeReplyKeyboard(ctx),
    })
  }

  if (rows.length === 0) {
    return ctx.reply(ctx.t('employee-requested-timesheets-empty'), {
      reply_markup: createEmployeeReplyKeyboard(ctx),
    })
  }

  for (const r of rows) {
    const keyboard = new InlineKeyboard()
      .text(
        ctx.t('employee-approve-yes'),
        timesheetApprovalData.pack({ row: r.sheetRow, value: PAYROLL_APPROVAL_CB_YES }),
      )
      .text(
        ctx.t('employee-approve-no'),
        timesheetApprovalData.pack({ row: r.sheetRow, value: PAYROLL_APPROVAL_CB_NO }),
      )

    const head = r.position.trim() ? `${r.fio} - ${r.position.trim()}` : r.fio
    const text = `${head}\n${r.monthLabel}\n${r.requestedDaysText}\n\n${ctx.t('employee-timesheet-approve-question')}`
    await ctx.reply(text, { reply_markup: keyboard })
  }

  return ctx.reply(ctx.t('employee-requested-timesheets-done'), {
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

feature
  .filter(ctx => ctx.has('message:text') && ctx.message.text === ctx.t('employee-btn-requested-timesheets'))
  .on(
    'message:text',
    logHandle('employee-requested-timesheets'),
    async (ctx) => {
      return sendEmployeeRequestedTimesheetsFlow(ctx)
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
            const username = usernameCell
            const jsonRow = await findJsonCalendarSheetRowForUsername(ctx, username)
            if (jsonRow != null) {
              const fromG = await readUserCalendarColumnG(ctx, jsonRow)
              const fromC = await readUserCalendarColumnC(ctx, jsonRow)
              const existingD = await readUserCalendarColumnD(ctx, jsonRow)
              const bucketsFromPh = parsePaymentHistoryRequestDayBuckets(
                bh[PH_REQUEST_GREEN_DAY_KEYS_INDEX],
              )
              const keysFromPh = unionPaymentHistoryRequestDayKeys(bucketsFromPh)
              const paidSoFar = new Set(
                existingD?.payrollSettlement?.kind === 'approved'
                  ? existingD.payrollSettlement.paidGreenKeys
                  : [],
              )
              const keysFromC = fromC
                ? unionDayKeysFromPayrollBuckets(fromC).filter(k => !paidSoFar.has(k))
                : []
              const keysForRequest = keysFromPh.length > 0 ? keysFromPh : keysFromC
              const hadPaid
                = existingD?.payrollSettlement?.kind === 'approved'
                  && existingD.payrollSettlement.paidGreenKeys.length > 0
              if (approved && keysForRequest.length === 0 && !hadPaid) {
                ctx.logger.warn(
                  { phSheetRow, jsonRow, fioFromPh },
                  'No day keys for this PH row (empty K and C); column D gets approved with empty paidGreenKeys',
                )
              }
              const columnD = applyPayrollPhDecisionToJsonCalendarD(approved, keysForRequest, existingD)
              await writeUserCalendarColumnD(ctx, jsonRow, columnD)
              if (keysForRequest.length > 0) {
                if (fromG) {
                  const nextG
                    = stripPaidKeysFromUserCalendarColumnG(fromG, keysForRequest) ?? emptyPayrollRequestColumnG()
                  try {
                    await writeUserCalendarColumnG(ctx, jsonRow, nextG)
                  }
                  catch (error) {
                    ctx.logger.warn(
                      { err: error, jsonRow, approved },
                      'Failed to sync JSON Calendar column G after payroll decision',
                    )
                  }
                }
                if (!approved) {
                  const nextC = stripKeysFromUserCalendarColumnC(fromC, keysForRequest)
                  try {
                    await writeUserCalendarColumnC(
                      ctx,
                      jsonRow,
                      nextC ?? emptyUserCalendarColumnCPayload(),
                    )
                  }
                  catch (error) {
                    ctx.logger.warn(
                      { err: error, jsonRow },
                      'Failed to sync JSON Calendar column C after payroll rejection',
                    )
                  }
                }
              }
            }
            try {
              const period = await readPaymentHistoryPeriodCellF(ctx, phSheetRow)
              const notifyText = approved
                ? ctx.t('user-notify-payroll-approved', { period: period || '—' })
                : ctx.t('user-notify-payroll-rejected', { period: period || '—' })
              await notifyUserByUsernameText(ctx, username, notifyText)
            }
            catch (error) {
              ctx.logger.warn(
                { err: error, usersRow, phSheetRow, approved },
                'Failed to notify user after payroll decision',
              )
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

feature.callbackQuery(
  timesheetApprovalData.filter(),
  logHandle('employee-timesheet-approval'),
  async (ctx) => {
    const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()

    if (!spreadsheetId) {
      await ctx.answerCallbackQuery({
        text: ctx.t('employee-approve-error'),
      })
      return
    }

    const { row: sheetRow, value: rawCb } = timesheetApprovalData.unpack(ctx.callbackQuery.data)
    const decision = parsePayrollApprovalDecision(rawCb)
    if (decision === null) {
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-error') })
      return
    }
    const approved = decision === 'yes'
    const statusRu = approved ? 'Одобрен' : 'Не одобрен'

    try {
      const updated = await updateTimesheetApprovalStatusIfPending(ctx, sheetRow, statusRu)
      if (!updated) {
        await tryStripApprovalInlineKeyboard(ctx)
        await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-already-handled') })
        return
      }

      try {
        const ab = await readTimesheetMonthLabelAndNickForRow(ctx, sheetRow)
        if (ab) {
          const ym = parseRuMonthLabelToYearMonth0(ab.monthLabel)
          if (ym) {
            const jsonRow = await findJsonCalendarSheetRowForUsername(ctx, ab.nick)
            if (jsonRow !== null) {
              if (approved) {
                const fromE = await readJsonCalendarTimesheetColumnE(ctx, jsonRow)
                const ePayload = fromE ?? { ...EMPTY_TIMESHEET_MONTH_JSON }
                const monthSnap = approvedFrozenSnapshotFromMonthKeysJson(ePayload, ym.y, ym.m0)
                const existingF = (await readJsonCalendarTimesheetColumnF(ctx, jsonRow))
                  ?? { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }
                const merged = mergeApprovedFrozenSnapshotReplaceMonth(
                  existingF,
                  monthSnap,
                  ym.y,
                  ym.m0,
                )
                await writeJsonCalendarTimesheetColumnF(ctx, jsonRow, merged)
              }
              else {
                const existingF = (await readJsonCalendarTimesheetColumnF(ctx, jsonRow))
                  ?? { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }
                const stripped = stripMonthKeysFromApprovedFrozenSnapshot(
                  existingF,
                  ym.y,
                  ym.m0,
                )
                if (JSON.stringify(stripped) !== JSON.stringify(existingF))
                  await writeJsonCalendarTimesheetColumnF(ctx, jsonRow, stripped)
              }
            }
          }

          try {
            const notifyText = approved
              ? ctx.t('user-notify-timesheet-approved', { month: ab.monthLabel })
              : ctx.t('user-notify-timesheet-rejected', { month: ab.monthLabel })
            await notifyUserByUsernameText(ctx, ab.nick, notifyText)
          }
          catch (error) {
            ctx.logger.warn({ err: error, sheetRow, approved }, 'Failed to notify user after timesheet decision')
          }
        }
      }
      catch (error) {
        ctx.logger.warn(
          { err: error, sheetRow, approved },
          'Failed to sync JSON Calendar column F after timesheet approval',
        )
      }

      await tryStripApprovalInlineKeyboard(ctx)
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-saved') })
    }
    catch (error) {
      ctx.logger.error({ err: error, spreadsheetId, sheetRow, approved }, 'Failed to write timesheet approval')
      await ctx.answerCallbackQuery({ text: ctx.t('employee-approve-error') })
    }
  },
)

export { composer as employeeFeature }
