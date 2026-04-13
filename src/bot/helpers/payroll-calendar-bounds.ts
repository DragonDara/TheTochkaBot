const TIME_ZONE_AQTOBE = 'Asia/Aqtobe'

/** Календарная дата в часовом поясе Asia/Aqtobe (как ключи дней y-m-d в боте). */
export function calendarDatePartsAqtobe(now: Date = new Date()): { y: number, m: number, d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE_AQTOBE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal')
      map[p.type] = p.value
  }
  return {
    y: Number(map.year),
    m: Number(map.month) - 1,
    d: Number(map.day),
  }
}

/** День строго после «сегодня» в Asia/Aqtobe (будущие даты недоступны для выбора). */
export function isCalendarDayAfterTodayAqtobe(
  year: number,
  month0: number,
  day: number,
  now: Date = new Date(),
): boolean {
  const t = calendarDatePartsAqtobe(now)
  if (year !== t.y)
    return year > t.y
  if (month0 !== t.m)
    return month0 > t.m
  return day > t.d
}

/** Январь предыдущего календарного года. */
export function minCalendarMonth(now: Date): { y: number, m: number } {
  return { y: now.getFullYear() - 1, m: 0 }
}

/** Декабрь следующего календарного года. */
export function maxCalendarMonth(now: Date): { y: number, m: number } {
  return { y: now.getFullYear() + 1, m: 11 }
}

function monthCmp(a: { y: number, m: number }, b: { y: number, m: number }): number {
  if (a.y !== b.y)
    return a.y - b.y
  return a.m - b.m
}

export function clampMonth(
  y: number,
  m: number,
  min: { y: number, m: number },
  max: { y: number, m: number },
): { y: number, m: number } {
  const cur = { y, m }
  if (monthCmp(cur, min) < 0)
    return { ...min }
  if (monthCmp(cur, max) > 0)
    return { ...max }
  return cur
}

export function addMonths(y: number, m: number, delta: number): { y: number, m: number } {
  const d = new Date(y, m + delta, 1)
  return { y: d.getFullYear(), m: d.getMonth() }
}

export function navigateMonth(
  y: number,
  m: number,
  direction: -1 | 1,
  min: { y: number, m: number },
  max: { y: number, m: number },
): { y: number, m: number } {
  const next = addMonths(y, m, direction)
  return clampMonth(next.y, next.m, min, max)
}

/** Табель: только текущий и следующий календарный месяц (Asia/Aqtobe). */
export function timesheetCalendarMinMaxMonth(now: Date = new Date()): {
  min: { y: number, m: number }
  max: { y: number, m: number }
} {
  const { y, m } = calendarDatePartsAqtobe(now)
  const max = addMonths(y, m, 1)
  return { min: { y, m }, max }
}

/** День табеля: кликабелен только в двух месяцах {@link timesheetCalendarMinMaxMonth} (по календарю ячейки, не по «сегодня»). */
export function isTimesheetDaySelectableAqtobe(
  year: number,
  month0: number,
  _day: number,
  now: Date = new Date(),
): boolean {
  const { min, max } = timesheetCalendarMinMaxMonth(now)
  const cellMonth = { y: year, m: month0 }
  return monthCmp(cellMonth, min) >= 0 && monthCmp(cellMonth, max) <= 0
}
