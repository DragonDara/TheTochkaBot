import type { Context } from '#root/bot/context.js'
import type { PayrollSettlementColumnD } from '#root/bot/helpers/payroll-user-calendar-d.js'
import { payrollCalendarData } from '#root/bot/callback-data/payroll-calendar.js'
import { isCalendarDayAfterTodayAqtobe } from '#root/bot/helpers/payroll-calendar-bounds.js'
import { InlineKeyboard } from 'grammy'

const ZWSP = '\u200B'

function toSet(keys?: Iterable<string> | string[]): Set<string> {
  if (!keys)
    return new Set()
  return new Set(Array.isArray(keys) ? keys : [...keys])
}

export interface PayrollCalendarOptions {
  /** «Запрос зарплаты»: каждый день включается/снимается отдельным кликом; только 🟢. */
  userCustomRangeSelection?: boolean
  /** Отмеченные/сохранённые дни пользователя — в клетке 🟢. */
  userCustomUserDayKeys?: Iterable<string> | string[]
  /** Уже сохранённые дни: те же эмодзи, но кнопки без callback «d» (не кликабельны). */
  userLockedSavedDayKeys?: Iterable<string> | string[]
  /** Решение сотрудника по запросу (колонка D): ✅+день без действия по клику или сброс при отказе. */
  userPayrollSettlement?: PayrollSettlementColumnD
}

function formatMonthTitle(localeCode: string, year: number, month: number): string {
  const loc = localeCode.startsWith('ru') ? 'ru-RU' : 'en-US'
  const d = new Date(year, month, 1)
  let s = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(d)
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return s
}

function packCb(action: string, year: number, month: number, day: number): string {
  return payrollCalendarData.pack({ a: action, m: month, y: year, d: day })
}

function userCustomDayLabelAndAction(
  dayCounter: number,
  k: string,
  userCustomUser: Set<string>,
  userLockedSaved: Set<string>,
  settlement: PayrollSettlementColumnD | undefined,
): { label: string, action: string } {
  const fromUser = userCustomUser.has(k)

  if (settlement?.kind === 'approved') {
    const paidG = new Set(settlement.paidGreenKeys)
    if (paidG.has(k))
      return { label: `✅${dayCounter}`, action: 'x' }
  }
  else if (settlement?.kind === 'rejected') {
    const rejG = new Set(settlement.rejectedGreenKeysToNumbers)
    if (rejG.has(k))
      return { label: String(dayCounter), action: 'x' }
  }

  const label = fromUser ? '🟢' : String(dayCounter)
  const action = userLockedSaved.has(k) ? 'x' : 'd'
  return { label, action }
}

export function createPayrollCalendarKeyboard(
  ctx: Context,
  year: number,
  month: number,
  localeCode: string,
  options?: PayrollCalendarOptions,
): InlineKeyboard {
  const userCustomRangeSelection = Boolean(options?.userCustomRangeSelection)
  const userCustomUser = toSet(options?.userCustomUserDayKeys)
  const userLockedSaved = toSet(options?.userLockedSavedDayKeys)
  const userPayrollSettlement = options?.userPayrollSettlement

  const kb = new InlineKeyboard()

  kb
    .text('←', packCb('p', year, month, 0))
    .text(formatMonthTitle(localeCode, year, month), packCb('x', year, month, 0))
    .text('→', packCb('n', year, month, 0))
    .row()

  const wdKeys = [
    'calendar-weekday-mon',
    'calendar-weekday-tue',
    'calendar-weekday-wed',
    'calendar-weekday-thu',
    'calendar-weekday-fri',
    'calendar-weekday-sat',
    'calendar-weekday-sun',
  ] as const
  for (const key of wdKeys)
    kb.text(ctx.t(key), packCb('x', year, month, 0))
  kb.row()

  const dim = new Date(year, month + 1, 0).getDate()
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7
  let dayCounter = 1 - startDow

  for (let i = 0; i < 42; i++) {
    let label: string
    let cb: string
    if (dayCounter < 1 || dayCounter > dim) {
      label = ZWSP
      cb = packCb('x', year, month, 0)
    }
    else {
      const k = `${year}-${month}-${dayCounter}`
      const future = isCalendarDayAfterTodayAqtobe(year, month, dayCounter)
      if (userCustomRangeSelection) {
        if (future) {
          label = String(dayCounter)
          cb = packCb('x', year, month, dayCounter)
        }
        else {
          const { label: l, action: act } = userCustomDayLabelAndAction(
            dayCounter,
            k,
            userCustomUser,
            userLockedSaved,
            userPayrollSettlement,
          )
          label = l
          cb = packCb(act, year, month, dayCounter)
        }
      }
      else {
        label = String(dayCounter)
        cb = packCb('x', year, month, dayCounter)
      }
    }
    kb.text(label, cb)
    if ((i + 1) % 7 === 0)
      kb.row()
    dayCounter++
  }

  return kb
}
