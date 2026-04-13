import type { Context } from '#root/bot/context.js'
import { timesheetCalendarData } from '#root/bot/callback-data/timesheet-calendar.js'
import { isTimesheetDaySelectableAqtobe } from '#root/bot/helpers/payroll-calendar-bounds.js'
import { InlineKeyboard } from 'grammy'

const ZWSP = '\u200B'

function tierEmoji(tier: 1 | 2): string {
  return tier === 1 ? '\u{1F7E1}' : '\u{1F535}'
}

function toSet(keys?: Iterable<string> | string[]): Set<string> {
  if (!keys)
    return new Set()
  return new Set(Array.isArray(keys) ? keys : [...keys])
}

export interface TimesheetCalendarOptions {
  /** Табель: день переключается по клику (число ↔ уровни). */
  userCustomRangeSelection?: boolean
  /** Уровень отметки по ключу дня: 1 — жёлтый, 2 — синий. */
  dayTiersByKey?: Record<string, 1 | 2>
  /** Ключи уже сохранённых дней — кнопки без callback «d». */
  userLockedSavedDayKeys?: Iterable<string> | string[]
  /** Если задан — среди двух месяцев Aqtobe кликабелен только этот. */
  selectionAnchorMonth?: { y: number, m: number }
  /** Ключи дней из одобренного табеля при входе: ✔️/☑️ и без клика; остальные отметки — 🟡/🔵. */
  approvedFrozenDayKeys?: Iterable<string> | string[]
}

function formatMonthTitle(localeCode: string, year: number, month: number): string {
  const loc = localeCode.startsWith('ru') ? 'ru-RU' : 'en-US'
  const d = new Date(year, month, 1)
  let s = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(d)
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return s
}

function packCb(action: string, year: number, month: number, day: number): string {
  return timesheetCalendarData.pack({ a: action, m: month, y: year, d: day })
}

function dayLabelAndAction(
  dayCounter: number,
  k: string,
  tiers: Record<string, 1 | 2>,
  userLockedSaved: Set<string>,
  approvedFrozen: Set<string>,
): { label: string, action: string } {
  const tier = tiers[k]
  let label = tier !== undefined ? tierEmoji(tier) : String(dayCounter)
  let action = userLockedSaved.has(k) ? 'x' : 'd'
  if (approvedFrozen.has(k) && tier !== undefined) {
    label = tier === 1 ? '\u2714\uFE0F' : '\u2611\uFE0F'
    action = 'x'
  }
  return { label, action }
}

export function createTimesheetCalendarKeyboard(
  ctx: Context,
  year: number,
  month: number,
  localeCode: string,
  options?: TimesheetCalendarOptions,
): InlineKeyboard {
  const userCustomRangeSelection = Boolean(options?.userCustomRangeSelection)
  const tiers = options?.dayTiersByKey ?? {}
  const userLockedSaved = toSet(options?.userLockedSavedDayKeys)
  const anchor = options?.selectionAnchorMonth
  const approvedFrozen = toSet(options?.approvedFrozenDayKeys)

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
      if (userCustomRangeSelection) {
        const selectable = isTimesheetDaySelectableAqtobe(year, month, dayCounter)
          && (anchor === undefined || (year === anchor.y && month === anchor.m))
        if (!selectable) {
          label = String(dayCounter)
          cb = packCb('x', year, month, dayCounter)
        }
        else {
          const { label: l, action: act } = dayLabelAndAction(
            dayCounter,
            k,
            tiers,
            userLockedSaved,
            approvedFrozen,
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
