import type { IikoEmployeeRecord, SalaryOnDate } from '#root/types/iiko-salary.js'
import { describe, expect, it } from 'vitest'
import {
  buildPayrollSliceRows,
  pickRateEffectiveFrom,
  pickRateValue,
} from './payroll-slice-mapper.js'

describe('pickRateValue', () => {
  it('предпочитает rate, затем salary', () => {
    expect(pickRateValue({ rate: 10, salary: 20 })).toBe('10')
    expect(pickRateValue({ salary: 20 })).toBe('20')
  })
  it('возвращает пусто для null', () => {
    expect(pickRateValue(null)).toBe('')
  })
})

describe('pickRateEffectiveFrom', () => {
  it('берёт dateFrom', () => {
    expect(pickRateEffectiveFrom({ dateFrom: '2024-01-15T00:00:00' })).toBe('2024-01-15T00:00:00')
  })
})

describe('buildPayrollSliceRows', () => {
  it('собирает 8 колонок на строку', () => {
    const em: IikoEmployeeRecord = {
      id: 'e1',
      name: 'Иванов Пётр',
      code: 'C01',
    }
    const sal: SalaryOnDate = { dateFrom: '2024-05-01T00:00:00', rate: 50000 }
    const rows = buildPayrollSliceRows({
      sliceDate: '2024-04-22',
      employees: [em],
      salaryByEmployeeId: new Map([['e1', sal]]),
      fetchedAtIso: '2024-04-23T00:00:00.000Z',
    })
    expect(rows).toEqual([[
      '2024-04-22',
      'e1',
      'Иванов Пётр',
      '',
      'C01',
      '50000',
      '2024-05-01T00:00:00',
      '2024-04-23T00:00:00.000Z',
    ]])
  })
})
