import type { IikoEmployeeRecord, SalaryOnDate } from '#root/types/iiko-salary.js'

/**
 * Сопоставить ФИО из объекта iiko.
 */
export function employeeDisplayName(e: IikoEmployeeRecord): string {
  if (e.name && String(e.name).trim()) {
    return String(e.name).trim()
  }
  const a = [e.lastName, e.firstName, e.middleName].map(x => (x == null ? '' : String(x).trim())).filter(Boolean)
  if (a.length)
    return a.join(' ').replace(/\s+/gu, ' ')
  return String(e.id)
}

/**
 * Должность (роль) из iiko: mainRole.name или string-поле.
 */
export function employeePosition(e: IikoEmployeeRecord): string {
  const m = e.mainRole
  if (m && typeof m === 'object' && m !== null) {
    const n = (m as { name?: string }).name
    if (n && String(n).trim()) {
      return String(n).trim()
    }
  }
  for (const k of ['postName', 'position', 'positionName', 'post']) {
    const v = e[k]
    if (typeof v === 'string' && v.trim()) {
      return v.trim()
    }
  }
  return ''
}

export function employeeCode(e: IikoEmployeeRecord): string {
  for (const k of ['code', 'personnelNumber', 'number']) {
    const v = e[k]
    if (v != null && String(v).trim()) {
      return String(v).trim()
    }
  }
  return ''
}

function numberToSheetCell(n: number): string {
  if (!Number.isFinite(n)) {
    return ''
  }
  return String(n)
}

/**
 * «Ставка» для листа: сначала месячные/суммовые поля, иначе почасовая.
 */
export function pickRateValue(s: SalaryOnDate | null | undefined): string {
  if (s == null)
    return ''
  const a = s.rate
  if (typeof a === 'number')
    return numberToSheetCell(a)
  const b = s.salary
  if (typeof b === 'number')
    return numberToSheetCell(b)
  const c = s.personalSalary
  if (typeof c === 'number') {
    return numberToSheetCell(c)
  }
  const d = s.hourlyRate
  if (typeof d === 'number') {
    return numberToSheetCell(d)
  }
  return ''
}

export function pickRateEffectiveFrom(s: SalaryOnDate | null | undefined): string {
  if (s == null)
    return ''
  const t = s.dateFrom
  if (typeof t !== 'string' || !t.trim()) {
    return ''
  }
  return t.trim()
}

export function buildPayrollSliceRows(
  input: {
    sliceDate: string
    employees: IikoEmployeeRecord[]
    salaryByEmployeeId: Map<string, SalaryOnDate | null | undefined>
    fetchedAtIso: string
  },
): string[][] {
  const { sliceDate, employees, salaryByEmployeeId, fetchedAtIso } = input
  return employees.map((e) => {
    const id = String(e.id)
    const s = salaryByEmployeeId.get(id) ?? null
    return [
      sliceDate,
      id,
      employeeDisplayName(e),
      employeePosition(e),
      employeeCode(e),
      pickRateValue(s),
      pickRateEffectiveFrom(s),
      fetchedAtIso,
    ]
  })
}
