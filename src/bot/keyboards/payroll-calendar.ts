import type { Context } from '#root/bot/context.js'
import type { PayrollSettlementColumnD } from '#root/bot/helpers/payroll-user-calendar-d.js'
import type { TimesheetMonthKeysJson, TimesheetTier } from '#root/bot/helpers/timesheet-sheet.js'
import { payrollCalendarData } from '#root/bot/callback-data/payroll-calendar.js'
import { isCalendarDayAfterTodayAqtobe } from '#root/bot/helpers/payroll-calendar-bounds.js'
import { InlineKeyboard } from 'grammy'

const ZWSP = '\u200B'

/** Base markers from approved timesheet (column F): check / ballot / radio. */
function baseMarkerLabel(tier: TimesheetTier, dayCounter: number): string {
  if (tier === 1)
    return `\u2714\uFE0F${dayCounter}`
  if (tier === 2)
    return `\u2611\uFE0F${dayCounter}`
  return `\uD83D\uDD18${dayCounter}`
}

/** Payroll request draft colors (yellow / blue / orange). */
function colorLabel(tier: TimesheetTier): string {
  if (tier === 1)
    return '\uD83D\uDFE1'
  if (tier === 2)
    return '\uD83D\uDD35'
  return '\uD83D\uDFE0'
}

function toSet(keys?: Iterable<string> | string[]): Set<string> {
  if (!keys)
    return new Set()
  return new Set(Array.isArray(keys) ? keys : [...keys])
}

function tierOfKeyInBuckets(k: string, buckets: TimesheetMonthKeysJson | undefined): TimesheetTier | undefined {
  if (!buckets)
    return undefined
  if (buckets.yellowKeys.includes(k))
    return 1
  if (buckets.blueKeys.includes(k))
    return 2
  if (buckets.orangeKeys.includes(k))
    return 3
  return undefined
}

export interface PayrollCalendarOptions {
  userCustomRangeSelection?: boolean
  payrollEligibleTierByKey?: Record<string, TimesheetTier>
  payrollDraftColoredKeys?: Iterable<string> | string[]
  payrollLockedBuckets?: TimesheetMonthKeysJson
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

function payrollRequestDayLabelAndAction(
  dayCounter: number,
  k: string,
  eligible: Record<string, TimesheetTier>,
  draftColored: Set<string>,
  lockedBuckets: TimesheetMonthKeysJson | undefined,
  settlement: PayrollSettlementColumnD | undefined,
): { label: string, action: string } {
  const tierEligible = eligible[k]

  if (settlement?.kind === 'approved') {
    const paidG = new Set(settlement.paidGreenKeys)
    if (paidG.has(k))
      return { label: `\u2705${dayCounter}`, action: 'x' }
  }
  else if (settlement?.kind === 'rejected') {
    const rejG = new Set(settlement.rejectedGreenKeysToNumbers)
    if (rejG.has(k))
      return { label: String(dayCounter), action: 'x' }
  }

  const tierLocked = tierOfKeyInBuckets(k, lockedBuckets)
  if (tierLocked !== undefined)
    return { label: colorLabel(tierLocked), action: 'x' }

  if (tierEligible === undefined)
    return { label: String(dayCounter), action: 'x' }

  if (draftColored.has(k))
    return { label: colorLabel(tierEligible), action: 'd' }

  return { label: baseMarkerLabel(tierEligible, dayCounter), action: 'd' }
}

export function createPayrollCalendarKeyboard(
  ctx: Context,
  year: number,
  month: number,
  localeCode: string,
  options?: PayrollCalendarOptions,
): InlineKeyboard {
  const userCustomRangeSelection = Boolean(options?.userCustomRangeSelection)
  const payrollEligibleTierByKey = options?.payrollEligibleTierByKey ?? {}
  const payrollDraftColored = toSet(options?.payrollDraftColoredKeys)
  const payrollLockedBuckets = options?.payrollLockedBuckets
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
        const { label: l, action: act } = payrollRequestDayLabelAndAction(
          dayCounter,
          k,
          payrollEligibleTierByKey,
          payrollDraftColored,
          payrollLockedBuckets,
          userPayrollSettlement,
        )
        label = l
        cb = packCb(future ? 'x' : act, year, month, dayCounter)
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
