/**
 * Ответ `GET /resto/api/employees/salary/byId/{employeeId}/{YYYY-MM-DD}` (JSON) в iikoServer.
 * Набор полей зависит от версии RMS; в типе — типичные ключи, остальное допускается.
 */
export interface SalaryOnDate {
  /** Дата вступления в силу ставки, на которую сработал срез (ISO, часто T00:00:00) */
  dateFrom?: string
  /** Суммовой оклад / месячная ставка, если iiko отдаёт в этом поле */
  rate?: number
  salary?: number
  personalSalary?: number
  /** Почасовая ставка (если используется в заведении) */
  hourlyRate?: number
  [key: string]: unknown
}

/**
 * Один сотрудник из `GET /resto/api/employees` (фрагмент; поля зависят от версии).
 */
export interface IikoEmployeeRecord {
  id: string
  name?: string
  firstName?: string
  lastName?: string
  middleName?: string
  code?: string
  mainRole?: { id?: string, name?: string, code?: string }
  [key: string]: unknown
}
