import type { Context } from '#root/bot/context.js'
import type { TimesheetTier } from '#root/bot/helpers/timesheet-sheet.js'
import { payrollCalendarData } from '#root/bot/callback-data/payroll-calendar.js'
import { timesheetCalendarData } from '#root/bot/callback-data/timesheet-calendar.js'
import { GREETING_CONVERSATION } from '#root/bot/conversations/greeting.js'
import { notifyAccountantsText } from '#root/bot/helpers/accountant-notify.js'
import { appendIdentificationUserIfNew } from '#root/bot/helpers/identification-sheet.js'
import {
  ensureJsonCalendarSheetRowForUsername,
  findJsonCalendarSheetRowForUsername,
} from '#root/bot/helpers/json-calendar-sheet.js'
import { logHandle } from '#root/bot/helpers/logging.js'
import {
  appendSalaryPaymentHistoryRow,
  computePayrollRequestAmountFromUsersRowTiered,
  listPendingPaymentHistoryRowsForUsersSheetRow,
  monthKeyAndLabelFromRequestDate,
  monthLabelRuFromParts,
  periodRangeTextFromDayKeys,
  readPaymentHistoryPeriodCellF,
  removeSalaryPaymentHistoryRow,
  weekDayKeysEndingYesterday,
} from '#root/bot/helpers/payment-history-sheet.js'
import {
  calendarDatePartsAqtobe,
  isTimesheetDaySelectableAqtobe,
  maxCalendarMonth,
  minCalendarMonth,
  navigateMonth,
  timesheetCalendarMinMaxMonth,
} from '#root/bot/helpers/payroll-calendar-bounds.js'
import {
  appendPayrollBucketsToColumnCDedupe,
  filterUserCalendarColumnCToPaidKeysOnly,
  readUserCalendarColumnC,
  writeUserCalendarColumnC,
} from '#root/bot/helpers/payroll-user-calendar-c.js'
import { readUserCalendarColumnD } from '#root/bot/helpers/payroll-user-calendar-d.js'
import {
  clearUserCalendarColumnG,
  emptyPayrollRequestColumnG,
  mergePayrollLockedAndDraftColored,
  payrollLockedKeysSet,
  unionDayKeysFromPayrollBuckets,
  writeUserCalendarColumnG,
} from '#root/bot/helpers/payroll-user-calendar-g.js'
import { findUsersPayrollRowByUsername } from '#root/bot/helpers/payroll-users-sheet.js'
import { usernameForSheetMatching } from '#root/bot/helpers/telegram-usernames.js'
import {
  clearTimesheetApprovalStatusCell,
  reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForUser,
} from '#root/bot/helpers/timesheet-approval-sheet.js'
import { syncTimesheetSessionOnEntry } from '#root/bot/helpers/timesheet-session-sync.js'
import {
  advanceTimesheetDraftTier,
  buildTimesheetJsonEPayload,
  EMPTY_TIMESHEET_APPROVED_FROZEN_JSON,
  EMPTY_TIMESHEET_MONTH_JSON,
  findTimesheetRowByMonthLabelAndUsername,
  parseTimesheetDayKey,
  payrollEligibleTierByKeyFromFrozenF,
  readJsonCalendarTimesheetColumnE,
  readJsonCalendarTimesheetColumnF,
  stripMonthKeysFromApprovedFrozenSnapshot,
  stripMonthKeysFromTimesheetPayload,
  timesheetMonthsToWriteRowsFor,
  timesheetShiftModeFromPosition,
  timesheetYmKey,
  writeJsonCalendarTimesheetColumnE,
  writeJsonCalendarTimesheetColumnF,
  writeTimesheetAjMonthTotalForUserRow,
  writeTimesheetDayCellsForMonth,
} from '#root/bot/helpers/timesheet-sheet.js'
import { createEmployeeUserActionsKeyboard } from '#root/bot/keyboards/employee-reply.js'
import { createHomeReplyKeyboard } from '#root/bot/keyboards/main-reply.js'
import { createPayrollCalendarKeyboard } from '#root/bot/keyboards/payroll-calendar.js'
import { createTimesheetCalendarKeyboard } from '#root/bot/keyboards/timesheet-calendar.js'
import { Composer } from 'grammy'

const composer = new Composer<Context>()

async function tryDeleteChatMessage(ctx: Context, chatId: number, messageId: number) {
  try {
    await ctx.api.deleteMessage(chatId, messageId)
  }
  catch {
    // уже удалено, нет прав, слишком старое
  }
}

/** Перед новым потоком календаря: старые inline-календари, подсказки и прошлые текстовые сообщения («зарплата» / «табель»). */
async function cleanupAllInlineCalendarFlows(ctx: Context) {
  const chatId = ctx.chat?.id
  if (chatId === undefined)
    return
  const uc = ctx.session.userCustomCalendar
  if (uc) {
    await tryDeleteChatMessage(ctx, chatId, uc.calendarMessageId)
    if (uc.actionsHintMessageId !== undefined)
      await tryDeleteChatMessage(ctx, chatId, uc.actionsHintMessageId)
    ctx.session.userCustomCalendar = undefined
  }
  const ts = ctx.session.timesheetCalendar
  if (ts) {
    await tryDeleteChatMessage(ctx, chatId, ts.calendarMessageId)
    if (ts.actionsHintMessageId !== undefined)
      await tryDeleteChatMessage(ctx, chatId, ts.actionsHintMessageId)
    ctx.session.timesheetCalendar = undefined
  }
  const prevUser = ctx.session.previousPayrollRequestUserMessageId
  if (prevUser !== undefined) {
    await tryDeleteChatMessage(ctx, chatId, prevUser)
    ctx.session.previousPayrollRequestUserMessageId = undefined
  }
  const prevTsFill = ctx.session.timesheetFillUserMessageId
  if (prevTsFill !== undefined) {
    await tryDeleteChatMessage(ctx, chatId, prevTsFill)
    ctx.session.timesheetFillUserMessageId = undefined
  }
}

function parseDayKey(key: string): { y: number, m: number, d: number } | null {
  const parts = key.split('-')
  if (parts.length !== 3)
    return null
  const y = Number(parts[0])
  const mo = Number(parts[1])
  const d = Number(parts[2])
  if (![y, mo, d].every(n => Number.isFinite(n)))
    return null
  return { y, m: mo, d }
}

function dayKeyTimeMs(key: string): number | null {
  const p = parseDayKey(key)
  if (!p)
    return null
  return new Date(p.y, p.m, p.d).getTime()
}

function userCustomCalendarKbOpts(uc: NonNullable<Context['session']['userCustomCalendar']>) {
  return {
    userCustomRangeSelection: true as const,
    payrollEligibleTierByKey: uc.payrollEligibleTierByKey,
    payrollDraftColoredKeys: uc.payrollDraftColoredKeys,
    payrollLockedBuckets: uc.payrollLockedBuckets,
    userPayrollSettlement: uc.payrollSettlement,
  }
}

function refreshTimesheetSelectionAnchorMonth(ts: NonNullable<Context['session']['timesheetCalendar']>) {
  const hasDraft = Object.keys(ts.draftDayStates).length > 0
  const hasLocked = Object.keys(ts.lockedDayStates).length > 0
  if (!hasDraft && !hasLocked) {
    ts.selectionAnchorMonth = undefined
    return
  }
  /** Якорь только при активном черновике: после «Сохранить» черновик пуст — снова без привязки к месяцу внутри текущего окна. */
  if (!hasDraft) {
    ts.selectionAnchorMonth = undefined
    return
  }
  if (ts.selectionAnchorMonth !== undefined)
    return
  const k = Object.keys(ts.draftDayStates)[0]
  const p = k ? parseDayKey(k) : null
  if (p)
    ts.selectionAnchorMonth = { y: p.y, m: p.m }
}

function timesheetCalendarKbOpts(ts: NonNullable<Context['session']['timesheetCalendar']>) {
  refreshTimesheetSelectionAnchorMonth(ts)
  const dayTiersByKey: Record<string, TimesheetTier> = { ...ts.lockedDayStates }
  for (const [k, tier] of Object.entries(ts.draftDayStates))
    dayTiersByKey[k] = tier
  return {
    userCustomRangeSelection: true as const,
    dayTiersByKey,
    userLockedSavedDayKeys: Object.keys(ts.lockedDayStates),
    selectionAnchorMonth: ts.selectionAnchorMonth,
    approvedFrozenDayKeys: ts.approvedFrozenDayKeys ?? [],
  }
}

const feature = composer.chatType('private')

feature.command('start', logHandle('command-start'), async (ctx) => {
  if (ctx.config.sheetsSpreadsheetId.trim()) {
    try {
      await appendIdentificationUserIfNew(ctx)
    }
    catch (error) {
      ctx.logger.warn({ err: error }, 'Failed to append user to Identification sheet')
    }
    const sheetUser = usernameForSheetMatching(ctx)
    if (sheetUser) {
      try {
        await reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForUser(ctx, sheetUser)
      }
      catch (error) {
        ctx.logger.warn({ err: error }, 'Failed to reconcile JSON Calendar F with Timesheet AI on /start')
      }
    }
  }
  return ctx.reply(ctx.t('welcome'), {
    reply_markup: await createHomeReplyKeyboard(ctx),
  })
})

feature.command('greeting', logHandle('command-greeting'), (ctx) => {
  return ctx.conversation.enter(GREETING_CONVERSATION)
})

feature
  .filter(ctx => ctx.has('message:text') && ctx.message.text === ctx.t('salary-btn-request'))
  .on(
    'message:text',
    logHandle('salary-request-payroll'),
    async (ctx) => {
      await cleanupAllInlineCalendarFlows(ctx)

      const now = new Date()
      const y = now.getFullYear()
      const mon = now.getMonth()
      const localeCode = await ctx.i18n.getLocale()

      let jsonCalendarSheetRow: number | null = null
      let payrollEligibleTierByKey: Record<string, TimesheetTier> = {}
      let payrollLockedBuckets = emptyPayrollRequestColumnG()
      let payrollSettlement = undefined as
        | NonNullable<Context['session']['userCustomCalendar']>['payrollSettlement']
        | undefined
      if (ctx.config.sheetsSpreadsheetId.trim()) {
        const sheetUser = usernameForSheetMatching(ctx)
        if (!sheetUser) {
          return ctx.reply(ctx.t('salary-request-no-username'), {
            reply_markup: await createHomeReplyKeyboard(ctx),
          })
        }
        try {
          await reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForUser(ctx, sheetUser)
        }
        catch (error) {
          ctx.logger.warn(
            { err: error },
            'Failed to reconcile JSON Calendar F with Timesheet AI on salary request',
          )
        }
        jsonCalendarSheetRow = await findJsonCalendarSheetRowForUsername(ctx, sheetUser)
        if (jsonCalendarSheetRow !== null) {
          try {
            const fromF = await readJsonCalendarTimesheetColumnF(ctx, jsonCalendarSheetRow)
            const frozen = fromF ?? { ...EMPTY_TIMESHEET_APPROVED_FROZEN_JSON }
            payrollEligibleTierByKey = payrollEligibleTierByKeyFromFrozenF(frozen)
          }
          catch (error) {
            ctx.logger.warn({ err: error }, 'Failed to read JSON calendar column F for payroll flow')
          }
          try {
            const fromC = await readUserCalendarColumnC(ctx, jsonCalendarSheetRow)
            if (fromC)
              payrollLockedBuckets = fromC
          }
          catch (error) {
            ctx.logger.warn({ err: error }, 'Failed to read JSON calendar column C for payroll flow')
          }
          try {
            const fromD = await readUserCalendarColumnD(ctx, jsonCalendarSheetRow)
            payrollSettlement = fromD?.payrollSettlement
          }
          catch (error) {
            ctx.logger.warn({ err: error }, 'Failed to read JSON calendar column D for user custom flow')
          }
        }
      }

      const calMsg = await ctx.reply(ctx.t('user-request-custom-prompt'), {
        reply_markup: createPayrollCalendarKeyboard(ctx, y, mon, localeCode, {
          userCustomRangeSelection: true,
          payrollEligibleTierByKey,
          payrollDraftColoredKeys: [],
          payrollLockedBuckets,
          userPayrollSettlement: payrollSettlement,
        }),
      })
      const hintMsg = await ctx.reply(ctx.t('user-request-custom-actions-hint'), {
        reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
      })
      ctx.session.userCustomCalendar = {
        calendarYear: y,
        calendarMonth: mon,
        calendarChatId: calMsg.chat.id,
        calendarMessageId: calMsg.message_id,
        actionsHintMessageId: hintMsg.message_id,
        payrollEligibleTierByKey,
        payrollLockedBuckets,
        payrollDraftColoredKeys: [],
        jsonCalendarSheetRow,
        paymentHistorySheetRows: [],
        payrollSettlement,
      }
      if (ctx.chat?.id !== undefined && ctx.message?.message_id !== undefined)
        ctx.session.previousPayrollRequestUserMessageId = ctx.message.message_id
    },
  )

feature
  .filter(ctx =>
    ctx.has('message:text')
    && ctx.message.text === ctx.t('timesheet-btn-fill'),
  )
  .on(
    'message:text',
    logHandle('user-timesheet-fill-entered'),
    async (ctx) => {
      await cleanupAllInlineCalendarFlows(ctx)

      const now = new Date()
      const { y: year, m: month } = calendarDatePartsAqtobe(now)
      const localeCode = await ctx.i18n.getLocale()

      ctx.session.timesheetCalendar = {
        calendarYear: year,
        calendarMonth: month,
        calendarChatId: 0,
        calendarMessageId: 0,
        lockedDayStates: {},
        draftDayStates: {},
        timesheetShiftMode: 'default',
        monthApprovalByYm: {},
        approvedFrozenDayKeys: [],
        pendingClearTimesheetDahForMonths: [],
      }
      const ts = ctx.session.timesheetCalendar
      const sheetUser = usernameForSheetMatching(ctx)
      if (sheetUser && ctx.config.sheetsSpreadsheetId.trim()) {
        try {
          await reconcileJsonCalendarTimesheetColumnFWithTimesheetAiForUser(ctx, sheetUser)
        }
        catch (error) {
          ctx.logger.warn(
            { err: error },
            'Failed to reconcile JSON Calendar F with Timesheet AI on timesheet fill',
          )
        }
        try {
          const usersHit = await findUsersPayrollRowByUsername(ctx, sheetUser)
          const positionCell = String(usersHit?.row[6] ?? '').trim()
          ts.timesheetShiftMode = timesheetShiftModeFromPosition(positionCell)
          await syncTimesheetSessionOnEntry(ctx, ts, sheetUser, now)
        }
        catch (error) {
          ctx.logger.warn({ err: error }, 'Failed to sync timesheet session from sheets on entry')
        }
      }

      const calMsg = await ctx.reply(ctx.t('user-request-custom-prompt'), {
        reply_markup: createTimesheetCalendarKeyboard(ctx, year, month, localeCode, timesheetCalendarKbOpts(ts)),
      })
      const hintMsg = await ctx.reply(ctx.t('user-request-custom-actions-hint'), {
        reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
      })
      ts.calendarChatId = calMsg.chat.id
      ts.calendarMessageId = calMsg.message_id
      ts.actionsHintMessageId = hintMsg.message_id
      if (ctx.chat?.id !== undefined && ctx.message?.message_id !== undefined)
        ctx.session.timesheetFillUserMessageId = ctx.message.message_id
    },
  )

feature
  .filter(ctx =>
    ctx.has('message:text')
    && Boolean(ctx.session.userCustomCalendar)
    && ctx.message.text === ctx.t('user-btn-request-week'),
  )
  .on(
    'message:text',
    logHandle('user-request-week-shortcut'),
    async (ctx) => {
      const uc = ctx.session.userCustomCalendar
      if (!uc)
        return
      const weekKeys = weekDayKeysEndingYesterday(new Date())
      const eligible = new Set(Object.keys(uc.payrollEligibleTierByKey))
      const locked = payrollLockedKeysSet(uc.payrollLockedBuckets)
      const paid = new Set(
        uc.payrollSettlement?.kind === 'approved' ? uc.payrollSettlement.paidGreenKeys : [],
      )
      const pick = weekKeys.filter(k => eligible.has(k) && !locked.has(k) && !paid.has(k))
      if (pick.length === 0) {
        return ctx.reply(ctx.t('user-calendar-week-no-free-days'), {
          reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
        })
      }
      uc.payrollDraftColoredKeys = pick
      const sorted = [...pick].sort((a, b) => (dayKeyTimeMs(a) ?? 0) - (dayKeyTimeMs(b) ?? 0))
      const first = sorted[0]!
      const p = parseDayKey(first)
      if (p) {
        uc.calendarYear = p.y
        uc.calendarMonth = p.m
      }
      const localeCode = await ctx.i18n.getLocale()
      const kb = createPayrollCalendarKeyboard(
        ctx,
        uc.calendarYear,
        uc.calendarMonth,
        localeCode,
        userCustomCalendarKbOpts(uc),
      )
      try {
        await ctx.api.editMessageReplyMarkup(
          uc.calendarChatId,
          uc.calendarMessageId,
          { reply_markup: kb },
        )
      }
      catch (error) {
        ctx.logger.error({ err: error }, 'Failed to apply week shortcut to calendar')
      }
    },
  )

feature
  .filter(ctx =>
    ctx.has('message:text')
    && Boolean(ctx.session.userCustomCalendar || ctx.session.timesheetCalendar)
    && ctx.message.text === ctx.t('employee-btn-distribute-save'),
  )
  .on(
    'message:text',
    logHandle('user-custom-calendar-save'),
    async (ctx) => {
      const ts = ctx.session.timesheetCalendar
      const uc = ctx.session.userCustomCalendar

      if (ts) {
        const chatId = ctx.chat?.id
        if (chatId !== undefined && ts.lastSaveAckPair) {
          await tryDeleteChatMessage(ctx, chatId, ts.lastSaveAckPair.userMessageId)
          await tryDeleteChatMessage(ctx, chatId, ts.lastSaveAckPair.botMessageId)
          ts.lastSaveAckPair = undefined
        }
        const sheetUser = usernameForSheetMatching(ctx)
        if (!sheetUser) {
          return ctx.reply(ctx.t('salary-request-no-username'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
          })
        }
        if (Object.keys(ts.draftDayStates).length === 0) {
          return ctx.reply(ctx.t('user-calendar-save-empty-draft'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
          })
        }
        const merged: Record<string, TimesheetTier> = { ...ts.lockedDayStates, ...ts.draftDayStates }
        const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
        if (!spreadsheetId) {
          return ctx.reply(ctx.t('timesheet-save-error'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
          })
        }

        const now = new Date()
        const monthsToWrite = timesheetMonthsToWriteRowsFor(merged, now)
        try {
          const jsonRow = await ensureJsonCalendarSheetRowForUsername(ctx, sheetUser)
          const ePayload = buildTimesheetJsonEPayload(merged, now)
          await writeJsonCalendarTimesheetColumnE(ctx, jsonRow, ePayload)

          const pendingOnly = [...(ts.pendingClearTimesheetDahForMonths ?? [])]
          for (const { y, m } of pendingOnly) {
            if (monthsToWrite.some(w => w.y === y && w.m === m))
              continue
            const label = monthLabelRuFromParts(y, m)
            const row = await findTimesheetRowByMonthLabelAndUsername(ctx, label, sheetUser)
            if (row === null) {
              return ctx.reply(ctx.t('timesheet-save-no-row', { month: label }), {
                reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
              })
            }
            await writeTimesheetDayCellsForMonth(ctx, row, y, m, {})
            await writeTimesheetAjMonthTotalForUserRow(ctx, row, y, m, {}, sheetUser)
            try {
              await clearTimesheetApprovalStatusCell(ctx, row)
            }
            catch (error) {
              ctx.logger.warn({ err: error, row }, 'Failed to clear Timesheet AI after timesheet save (pending clear)')
            }
            ts.pendingClearTimesheetDahForMonths = (ts.pendingClearTimesheetDahForMonths ?? []).filter(
              p => !(p.y === y && p.m === m),
            )
          }
          for (const { y, m } of monthsToWrite) {
            const label = monthLabelRuFromParts(y, m)
            const row = await findTimesheetRowByMonthLabelAndUsername(ctx, label, sheetUser)
            if (row === null) {
              return ctx.reply(ctx.t('timesheet-save-no-row', { month: label }), {
                reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
              })
            }
            if ((ts.pendingClearTimesheetDahForMonths ?? []).some(p => p.y === y && p.m === m)) {
              await writeTimesheetDayCellsForMonth(ctx, row, y, m, {})
              ts.pendingClearTimesheetDahForMonths = (ts.pendingClearTimesheetDahForMonths ?? []).filter(
                p => !(p.y === y && p.m === m),
              )
            }
            await writeTimesheetDayCellsForMonth(ctx, row, y, m, merged)
            await writeTimesheetAjMonthTotalForUserRow(ctx, row, y, m, merged, sheetUser)
            try {
              await clearTimesheetApprovalStatusCell(ctx, row)
            }
            catch (error) {
              ctx.logger.warn({ err: error, row }, 'Failed to clear Timesheet AI after timesheet save')
            }
          }
        }
        catch (error) {
          ctx.logger.error({ err: error, spreadsheetId }, 'Failed to save timesheet to sheets')
          return ctx.reply(ctx.t('timesheet-save-error'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
          })
        }

        ts.lockedDayStates = merged
        ts.draftDayStates = {}
        ts.selectionAnchorMonth = undefined

        try {
          const localeCodeAfterSave = await ctx.i18n.getLocale()
          const kbAfterSave = createTimesheetCalendarKeyboard(
            ctx,
            ts.calendarYear,
            ts.calendarMonth,
            localeCodeAfterSave,
            timesheetCalendarKbOpts(ts),
          )
          await ctx.api.editMessageReplyMarkup(
            ts.calendarChatId,
            ts.calendarMessageId,
            { reply_markup: kbAfterSave },
          )
        }
        catch (error) {
          ctx.logger.warn({ err: error }, 'Failed to refresh timesheet calendar after save')
        }

        try {
          const monthsLabel = monthsToWrite.length > 0
            ? monthsToWrite.map(({ y, m }) => monthLabelRuFromParts(y, m)).join(', ')
            : '—'
          const actorRow = await findUsersPayrollRowByUsername(ctx, sheetUser)
          const position = String(actorRow?.row[6] ?? '').trim() || '—'
          const fio = String(actorRow?.row[1] ?? '').trim() || '—'
          await notifyAccountantsText(
            ctx,
            ctx.t('accountant-notify-timesheet-saved', { position, fio, months: monthsLabel }),
          )
        }
        catch (error) {
          ctx.logger.warn({ err: error }, 'Accountant notify after timesheet save failed')
        }

        const saveOkMsg = await ctx.reply(ctx.t('user-calendar-c-save-ok'), {
          reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
        })
        if (ctx.message?.message_id !== undefined)
          ts.lastSaveAckPair = { userMessageId: ctx.message.message_id, botMessageId: saveOkMsg.message_id }
        return saveOkMsg
      }

      if (!uc)
        return
      const chatId = ctx.chat?.id
      if (chatId !== undefined && uc.lastSaveAckPair) {
        await tryDeleteChatMessage(ctx, chatId, uc.lastSaveAckPair.userMessageId)
        await tryDeleteChatMessage(ctx, chatId, uc.lastSaveAckPair.botMessageId)
        uc.lastSaveAckPair = undefined
      }
      const sheetUser = usernameForSheetMatching(ctx)
      if (!sheetUser) {
        return ctx.reply(ctx.t('salary-request-no-username'), {
          reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
        })
      }
      if (uc.payrollDraftColoredKeys.length === 0) {
        return ctx.reply(ctx.t('user-calendar-save-empty-draft'), {
          reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
        })
      }
      const draftOnlyBuckets = mergePayrollLockedAndDraftColored(
        emptyPayrollRequestColumnG(),
        uc.payrollDraftColoredKeys,
        uc.payrollEligibleTierByKey,
      )
      const ny = draftOnlyBuckets.yellowKeys.length
      const nb = draftOnlyBuckets.blueKeys.length
      const no = draftOnlyBuckets.orangeKeys.length
      const periodKeys = unionDayKeysFromPayrollBuckets(draftOnlyBuckets)
      const mergedBuckets = mergePayrollLockedAndDraftColored(
        uc.payrollLockedBuckets,
        uc.payrollDraftColoredKeys,
        uc.payrollEligibleTierByKey,
      )
      const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
      let lockedAfterSave = mergedBuckets
      try {
        let row = uc.jsonCalendarSheetRow
        if (row == null)
          row = await ensureJsonCalendarSheetRowForUsername(ctx, sheetUser)
        await writeUserCalendarColumnG(ctx, row, mergedBuckets)
        uc.jsonCalendarSheetRow = row
        try {
          const curC = await readUserCalendarColumnC(ctx, row)
          const newC = appendPayrollBucketsToColumnCDedupe(curC, mergedBuckets)
          await writeUserCalendarColumnC(ctx, row, newC)
          lockedAfterSave = newC
        }
        catch (error) {
          ctx.logger.warn({ err: error, row }, 'Failed to append JSON calendar column C after payroll save')
        }
      }
      catch (error) {
        ctx.logger.error({ err: error, row: uc.jsonCalendarSheetRow }, 'Failed to save user calendar column G')
        return ctx.reply(ctx.t('user-calendar-c-save-error'), {
          reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
        })
      }

      let usersPayrollHit: Awaited<ReturnType<typeof findUsersPayrollRowByUsername>> = null
      if (spreadsheetId) {
        usersPayrollHit = await findUsersPayrollRowByUsername(ctx, sheetUser)
        if (!usersPayrollHit) {
          return ctx.reply(ctx.t('user-calendar-c-save-no-users-row'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
          })
        }
      }

      if (usersPayrollHit && spreadsheetId) {
        const requestedAmount = computePayrollRequestAmountFromUsersRowTiered(
          usersPayrollHit.row,
          ny,
          nb,
          no,
        )
        if (requestedAmount === null) {
          ctx.logger.warn(
            { row: usersPayrollHit.rowNumber, ny, nb, no },
            'Users D/E/F invalid or D=0 — cannot compute request amount',
          )
          return ctx.reply(ctx.t('user-calendar-users-ed-invalid'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
          })
        }
        const requestedAt = new Date()
        const { monthKey, monthLabel } = monthKeyAndLabelFromRequestDate(requestedAt)
        const periodText = periodRangeTextFromDayKeys(periodKeys)
        const fio = String(usersPayrollHit.row[1] ?? '').trim()
        const position = String(usersPayrollHit.row[6] ?? '').trim()
        try {
          const histRow = await appendSalaryPaymentHistoryRow(ctx, {
            monthKey,
            monthLabel,
            fio,
            position,
            requestedAt,
            periodText,
            yellowDayCount: ny,
            blueDayCount: nb,
            orangeDayCount: no,
            requestDayBuckets: draftOnlyBuckets,
            requestedAmount,
            status: 'Запрошена',
          })
          uc.paymentHistorySheetRows = [...uc.paymentHistorySheetRows, histRow]
          try {
            await notifyAccountantsText(
              ctx,
              ctx.t('accountant-notify-payroll-period', {
                position: position || '—',
                fio: fio || '—',
                period: periodText || '—',
              }),
            )
          }
          catch (errNotify) {
            ctx.logger.warn({ err: errNotify }, 'Accountant notify after payroll save failed')
          }
        }
        catch (error) {
          ctx.logger.error({ err: error, spreadsheetId }, 'Failed to append payment history (custom save)')
        }
      }

      uc.payrollLockedBuckets = lockedAfterSave
      uc.payrollDraftColoredKeys = []

      try {
        const localeCodeAfterSave = await ctx.i18n.getLocale()
        const kbAfterSave = createPayrollCalendarKeyboard(
          ctx,
          uc.calendarYear,
          uc.calendarMonth,
          localeCodeAfterSave,
          userCustomCalendarKbOpts(uc),
        )
        await ctx.api.editMessageReplyMarkup(
          uc.calendarChatId,
          uc.calendarMessageId,
          { reply_markup: kbAfterSave },
        )
      }
      catch (error) {
        ctx.logger.warn({ err: error }, 'Failed to refresh calendar after custom save')
      }

      const saveOkMsg = await ctx.reply(ctx.t('user-calendar-c-save-ok'), {
        reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
      })
      if (ctx.message?.message_id !== undefined)
        uc.lastSaveAckPair = { userMessageId: ctx.message.message_id, botMessageId: saveOkMsg.message_id }
      return saveOkMsg
    },
  )

feature
  .filter(ctx =>
    ctx.has('message:text')
    && Boolean(ctx.session.userCustomCalendar || ctx.session.timesheetCalendar)
    && ctx.message.text === ctx.t('employee-btn-distribute-reset'),
  )
  .on(
    'message:text',
    logHandle('user-custom-calendar-reset'),
    async (ctx) => {
      const ts = ctx.session.timesheetCalendar
      const uc = ctx.session.userCustomCalendar

      if (ts) {
        const nowReset = new Date()
        const { min: minM } = timesheetCalendarMinMaxMonth(nowReset)
        const ymApproved = (y: number, m: number) =>
          ts.monthApprovalByYm?.[timesheetYmKey(y, m)] === 'approved'
        const minAp = ymApproved(minM.y, minM.m)

        if (minAp) {
          ts.draftDayStates = {}
          ts.selectionAnchorMonth = undefined
          const localeCodeBlocked = await ctx.i18n.getLocale()
          try {
            await ctx.api.editMessageReplyMarkup(
              ts.calendarChatId,
              ts.calendarMessageId,
              {
                reply_markup: createTimesheetCalendarKeyboard(
                  ctx,
                  ts.calendarYear,
                  ts.calendarMonth,
                  localeCodeBlocked,
                  timesheetCalendarKbOpts(ts),
                ),
              },
            )
          }
          catch (error) {
            ctx.logger.error({ err: error }, 'Failed to refresh timesheet calendar after blocked reset')
          }
          return ctx.reply(ctx.t('timesheet-reset-blocked-approved'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
          })
        }

        const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()
        const sheetUser = usernameForSheetMatching(ctx)
        if (spreadsheetId && sheetUser) {
          try {
            const jsonRow = await findJsonCalendarSheetRowForUsername(ctx, sheetUser)
            if (jsonRow !== null) {
              const read = await readJsonCalendarTimesheetColumnE(ctx, jsonRow)
              let current = read ?? { ...EMPTY_TIMESHEET_MONTH_JSON }
              if (!minAp)
                current = stripMonthKeysFromTimesheetPayload(current, minM.y, minM.m)
              await writeJsonCalendarTimesheetColumnE(ctx, jsonRow, current)
              if (!minAp) {
                const readF = await readJsonCalendarTimesheetColumnF(ctx, jsonRow)
                if (readF) {
                  const strippedF = stripMonthKeysFromApprovedFrozenSnapshot(
                    readF,
                    minM.y,
                    minM.m,
                  )
                  if (JSON.stringify(strippedF) !== JSON.stringify(readF))
                    await writeJsonCalendarTimesheetColumnF(ctx, jsonRow, strippedF)
                }
              }
            }
            if (!minAp) {
              const label = monthLabelRuFromParts(minM.y, minM.m)
              const row = await findTimesheetRowByMonthLabelAndUsername(ctx, label, sheetUser)
              if (row !== null) {
                await writeTimesheetDayCellsForMonth(ctx, row, minM.y, minM.m, {})
                await writeTimesheetAjMonthTotalForUserRow(ctx, row, minM.y, minM.m, {}, sheetUser)
              }
            }
          }
          catch (error) {
            ctx.logger.error({ err: error }, 'Failed to clear timesheet data in Google Sheets on reset')
          }
        }

        const nextLocked: Record<string, TimesheetTier> = {}
        for (const [k, tier] of Object.entries(ts.lockedDayStates)) {
          const p = parseTimesheetDayKey(k)
          if (p && ymApproved(p.y, p.m))
            nextLocked[k] = tier
        }
        ts.lockedDayStates = nextLocked
        ts.draftDayStates = {}
        ts.selectionAnchorMonth = undefined
        ts.pendingClearTimesheetDahForMonths = (ts.pendingClearTimesheetDahForMonths ?? []).filter(
          p => !ymApproved(p.y, p.m),
        )
        if (!minAp) {
          ts.monthApprovalByYm = {}
          ts.approvedFrozenDayKeys = []
        }

        const localeCode = await ctx.i18n.getLocale()
        const kbReset = createTimesheetCalendarKeyboard(
          ctx,
          ts.calendarYear,
          ts.calendarMonth,
          localeCode,
          timesheetCalendarKbOpts(ts),
        )
        try {
          await ctx.api.editMessageReplyMarkup(
            ts.calendarChatId,
            ts.calendarMessageId,
            { reply_markup: kbReset },
          )
        }
        catch (error) {
          ctx.logger.error({ err: error }, 'Failed to reset timesheet calendar markup')
        }
        try {
          const clearedMonths = !minAp ? [minM] : []
          const monthsLabel = clearedMonths.length > 0
            ? clearedMonths.map(({ y, m }) => monthLabelRuFromParts(y, m)).join(', ')
            : '—'
          const actorTsReset = sheetUser ? await findUsersPayrollRowByUsername(ctx, sheetUser) : null
          const position = String(actorTsReset?.row[6] ?? '').trim() || '—'
          const fio = String(actorTsReset?.row[1] ?? '').trim() || '—'
          await notifyAccountantsText(
            ctx,
            ctx.t('accountant-notify-timesheet-reset', { position, fio, months: monthsLabel }),
          )
        }
        catch (error) {
          ctx.logger.warn({ err: error }, 'Accountant notify after timesheet reset failed')
        }
        return ctx.reply(ctx.t('timesheet-reset-ok'), {
          reply_markup: createEmployeeUserActionsKeyboard(ctx, {}),
        })
      }

      if (!uc)
        return
      const sheetUserPayrollReset = usernameForSheetMatching(ctx)
      const actorPayrollReset = sheetUserPayrollReset
        ? await findUsersPayrollRowByUsername(ctx, sheetUserPayrollReset)
        : null
      const pendingPayrollRows = actorPayrollReset
        ? await listPendingPaymentHistoryRowsForUsersSheetRow(ctx, actorPayrollReset.rowNumber)
        : []
      let payrollResetPeriod = '—'
      if (pendingPayrollRows.length > 0) {
        payrollResetPeriod = await readPaymentHistoryPeriodCellF(
          ctx,
          Math.max(...pendingPayrollRows),
        ) || '—'
      }
      const payrollResetPosition = String(actorPayrollReset?.row[6] ?? '').trim() || '—'
      const payrollResetFio = String(actorPayrollReset?.row[1] ?? '').trim() || '—'

      uc.payrollLockedBuckets = emptyPayrollRequestColumnG()
      uc.payrollDraftColoredKeys = []

      const spreadsheetId = ctx.config.sheetsSpreadsheetId.trim()

      if (spreadsheetId && pendingPayrollRows.length > 0) {
        for (const phRow of [...pendingPayrollRows].sort((a, b) => b - a)) {
          try {
            await removeSalaryPaymentHistoryRow(ctx, phRow)
          }
          catch (error) {
            ctx.logger.error({ err: error, row: phRow }, 'Failed to remove payment history row on reset')
          }
        }
        uc.paymentHistorySheetRows = []
      }

      if (uc.jsonCalendarSheetRow !== null && uc.jsonCalendarSheetRow !== undefined) {
        try {
          await clearUserCalendarColumnG(ctx, uc.jsonCalendarSheetRow)
        }
        catch (error) {
          ctx.logger.error({ err: error, row: uc.jsonCalendarSheetRow }, 'Failed to clear user calendar column G')
          await ctx.reply(ctx.t('user-calendar-c-reset-sheet-error'), {
            reply_markup: createEmployeeUserActionsKeyboard(ctx, { includeWeekRequest: true }),
          })
        }
        try {
          const fromD = await readUserCalendarColumnD(ctx, uc.jsonCalendarSheetRow)
          uc.payrollSettlement = fromD?.payrollSettlement
          const paidKeys = new Set(
            fromD?.payrollSettlement?.kind === 'approved'
              ? fromD.payrollSettlement.paidGreenKeys
              : [],
          )
          const curC = await readUserCalendarColumnC(ctx, uc.jsonCalendarSheetRow)
          const filteredC = filterUserCalendarColumnCToPaidKeysOnly(curC, paidKeys)
          await writeUserCalendarColumnC(ctx, uc.jsonCalendarSheetRow, filteredC)
          uc.payrollLockedBuckets = filteredC
        }
        catch (error) {
          ctx.logger.warn({ err: error }, 'Failed to sync JSON calendar C/D after payroll reset')
          try {
            const fallbackC = await readUserCalendarColumnC(ctx, uc.jsonCalendarSheetRow)
            uc.payrollLockedBuckets = fallbackC ?? emptyPayrollRequestColumnG()
          }
          catch {
            uc.payrollLockedBuckets = emptyPayrollRequestColumnG()
          }
        }
      }

      const localeCode = await ctx.i18n.getLocale()
      const kbReset = createPayrollCalendarKeyboard(
        ctx,
        uc.calendarYear,
        uc.calendarMonth,
        localeCode,
        userCustomCalendarKbOpts(uc),
      )
      try {
        await ctx.api.editMessageReplyMarkup(
          uc.calendarChatId,
          uc.calendarMessageId,
          { reply_markup: kbReset },
        )
      }
      catch (error) {
        ctx.logger.error({ err: error }, 'Failed to reset user custom calendar markup')
      }

      try {
        await notifyAccountantsText(
          ctx,
          ctx.t('accountant-notify-payroll-reset', {
            position: payrollResetPosition,
            fio: payrollResetFio,
            period: payrollResetPeriod,
          }),
        )
      }
      catch (error) {
        ctx.logger.warn({ err: error }, 'Accountant notify after payroll reset failed')
      }
    },
  )

feature
  .filter(ctx =>
    ctx.has('message:text')
    && Boolean(ctx.session.userCustomCalendar || ctx.session.timesheetCalendar)
    && ctx.message.text === ctx.t('employee-btn-back'),
  )
  .on(
    'message:text',
    logHandle('user-custom-calendar-exit'),
    async (ctx) => {
      ctx.session.userCustomCalendar = undefined
      ctx.session.timesheetCalendar = undefined
      return ctx.reply(ctx.t('welcome'), {
        reply_markup: await createHomeReplyKeyboard(ctx),
      })
    },
  )

feature.callbackQuery(
  payrollCalendarData.filter(),
  logHandle('payroll-calendar'),
  async (ctx) => {
    const { a, m, y, d } = payrollCalendarData.unpack(ctx.callbackQuery.data)
    const localeCode = await ctx.i18n.getLocale()
    const now = new Date()
    const min = minCalendarMonth(now)
    const max = maxCalendarMonth(now)
    const uc = ctx.session.userCustomCalendar
    const msgId = ctx.callbackQuery.message?.message_id
    const isUserCustomCalendar = Boolean(uc && msgId !== undefined && msgId === uc.calendarMessageId)

    if (isUserCustomCalendar && uc && uc.jsonCalendarSheetRow != null && ctx.config.sheetsSpreadsheetId.trim()) {
      try {
        const fromD = await readUserCalendarColumnD(ctx, uc.jsonCalendarSheetRow)
        uc.payrollSettlement = fromD?.payrollSettlement
      }
      catch (error) {
        ctx.logger.warn({ err: error }, 'Failed to refresh JSON calendar column D for payroll calendar')
      }
    }

    if (a === 'd' && d > 0) {
      if (isUserCustomCalendar && uc) {
        const key = `${y}-${m}-${d}`
        if (uc.payrollEligibleTierByKey[key] === undefined) {
          await ctx.answerCallbackQuery()
          return
        }
        const locked = payrollLockedKeysSet(uc.payrollLockedBuckets)
        if (locked.has(key)) {
          await ctx.answerCallbackQuery()
          return
        }
        const paid = new Set(
          uc.payrollSettlement?.kind === 'approved' ? uc.payrollSettlement.paidGreenKeys : [],
        )
        if (paid.has(key)) {
          await ctx.answerCallbackQuery()
          return
        }
        const draft = new Set(uc.payrollDraftColoredKeys)
        if (draft.has(key))
          draft.delete(key)
        else
          draft.add(key)
        uc.payrollDraftColoredKeys = [...draft].sort(
          (a, b) => (dayKeyTimeMs(a) ?? 0) - (dayKeyTimeMs(b) ?? 0),
        )

        uc.calendarYear = y
        uc.calendarMonth = m

        const kb = createPayrollCalendarKeyboard(ctx, y, m, localeCode, userCustomCalendarKbOpts(uc))
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: kb })
        }
        catch (error) {
          ctx.logger.error({ err: error }, 'Failed to edit user custom calendar after day click')
        }
        await ctx.answerCallbackQuery()
        return
      }

      await ctx.answerCallbackQuery()
      return
    }

    if (a === 'x') {
      if (d === 0) {
        await ctx.answerCallbackQuery()
        return
      }
      if (isUserCustomCalendar && uc) {
        const key = `${y}-${m}-${d}`
        const paid = new Set(
          uc.payrollSettlement?.kind === 'approved' ? uc.payrollSettlement.paidGreenKeys : [],
        )
        if (paid.has(key)) {
          await ctx.answerCallbackQuery()
          return
        }
        const locked = payrollLockedKeysSet(uc.payrollLockedBuckets)
        if (locked.has(key)) {
          await ctx.answerCallbackQuery({
            show_alert: true,
            text: ctx.t('user-calendar-payroll-already-submitted-alert'),
          })
          return
        }
        await ctx.answerCallbackQuery()
        return
      }
      await ctx.answerCallbackQuery()
      return
    }

    if (a !== 'p' && a !== 'n') {
      await ctx.answerCallbackQuery()
      return
    }

    const dir: -1 | 1 = a === 'p' ? -1 : 1
    const { y: ny, m: nm } = navigateMonth(y, m, dir, min, max)

    let kb
    if (isUserCustomCalendar && uc) {
      uc.calendarYear = ny
      uc.calendarMonth = nm
      kb = createPayrollCalendarKeyboard(ctx, ny, nm, localeCode, userCustomCalendarKbOpts(uc))
    }
    else {
      kb = createPayrollCalendarKeyboard(ctx, ny, nm, localeCode)
    }

    try {
      await ctx.editMessageReplyMarkup({ reply_markup: kb })
    }
    catch (error) {
      ctx.logger.error({ err: error }, 'Failed to edit payroll calendar markup')
    }
    await ctx.answerCallbackQuery()
  },
)

feature.callbackQuery(
  timesheetCalendarData.filter(),
  logHandle('timesheet-calendar'),
  async (ctx) => {
    const { a, m, y, d } = timesheetCalendarData.unpack(ctx.callbackQuery.data)
    const localeCode = await ctx.i18n.getLocale()
    const now = new Date()
    const min = minCalendarMonth(now)
    const max = maxCalendarMonth(now)
    const ts = ctx.session.timesheetCalendar
    const msgId = ctx.callbackQuery.message?.message_id
    const isTimesheetCalendar = Boolean(ts && msgId !== undefined && msgId === ts.calendarMessageId)

    if (a === 'd' && d > 0) {
      if (isTimesheetCalendar && ts) {
        if (!isTimesheetDaySelectableAqtobe(y, m, d)) {
          await ctx.answerCallbackQuery()
          return
        }
        refreshTimesheetSelectionAnchorMonth(ts)
        if (ts.selectionAnchorMonth !== undefined
          && (y !== ts.selectionAnchorMonth.y || m !== ts.selectionAnchorMonth.m)) {
          await ctx.answerCallbackQuery()
          return
        }
        const key = `${y}-${m}-${d}`
        const approvedFrozen = ts.approvedFrozenDayKeys ?? []
        if (approvedFrozen.includes(key)) {
          await ctx.answerCallbackQuery({
            show_alert: true,
            text: ctx.t('timesheet-month-already-approved-alert'),
          })
          return
        }
        const cur
          = ts.draftDayStates[key] !== undefined
            ? ts.draftDayStates[key]
            : ts.lockedDayStates[key]
        const nextTier = advanceTimesheetDraftTier(cur, ts.timesheetShiftMode)
        const nextDraft = { ...ts.draftDayStates }
        if (nextTier === undefined)
          delete nextDraft[key]
        else
          nextDraft[key] = nextTier
        ts.draftDayStates = nextDraft
        refreshTimesheetSelectionAnchorMonth(ts)

        ts.calendarYear = y
        ts.calendarMonth = m

        const kb = createTimesheetCalendarKeyboard(ctx, y, m, localeCode, timesheetCalendarKbOpts(ts))
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: kb })
        }
        catch (error) {
          ctx.logger.error({ err: error }, 'Failed to edit timesheet calendar after day click')
        }
        await ctx.answerCallbackQuery()
        return
      }

      await ctx.answerCallbackQuery()
      return
    }

    if (a === 'i') {
      await ctx.answerCallbackQuery()
      return
    }

    if (a === 'm' && d > 0) {
      await ctx.answerCallbackQuery({
        show_alert: true,
        text: ctx.t('timesheet-anchor-other-month-alert'),
      })
      return
    }

    if (a === 'r' && d > 0) {
      await ctx.answerCallbackQuery({
        show_alert: true,
        text: ctx.t('timesheet-month-already-approved-alert'),
      })
      return
    }

    if (a === 'x') {
      await ctx.answerCallbackQuery({
        show_alert: true,
        text: ctx.t('user-calendar-settled-day-alert'),
      })
      return
    }

    if (a !== 'p' && a !== 'n') {
      await ctx.answerCallbackQuery()
      return
    }

    const dir: -1 | 1 = a === 'p' ? -1 : 1
    const { y: ny, m: nm } = navigateMonth(y, m, dir, min, max)

    let kb
    if (isTimesheetCalendar && ts) {
      ts.calendarYear = ny
      ts.calendarMonth = nm
      kb = createTimesheetCalendarKeyboard(ctx, ny, nm, localeCode, timesheetCalendarKbOpts(ts))
    }
    else {
      kb = createTimesheetCalendarKeyboard(ctx, ny, nm, localeCode)
    }

    try {
      await ctx.editMessageReplyMarkup({ reply_markup: kb })
    }
    catch (error) {
      ctx.logger.error({ err: error }, 'Failed to edit timesheet calendar markup')
    }
    await ctx.answerCallbackQuery()
  },
)

export { composer as welcomeFeature }
