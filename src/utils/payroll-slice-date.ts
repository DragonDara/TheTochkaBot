/**
 * «Сегодняшняя» календарная дата (YYYY-MM-DD) в заданной IANA-таймзоне, затем сдвиг на N календарных дней
 * (через калиброванное смещение в миллисекундах; границы полуночного cron обычно вне зоны DST-рисков).
 */
export function formatSliceYmd(anchor: Date, timeZone: string, offsetDays: number): string {
  const withOffset = new Date(anchor.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(withOffset)
}
