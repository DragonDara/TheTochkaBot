import process from 'node:process'
import { API_CONSTANTS } from 'grammy'
import * as v from 'valibot'

const baseConfigSchema = v.object({
  debug: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.boolean()), 'false'),
  logLevel: v.optional(v.pipe(v.string(), v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])), 'info'),
  botToken: v.pipe(v.string(), v.regex(/^\d+:[\w-]+$/, 'Invalid token')),
  botAllowedUpdates: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.array(v.picklist(API_CONSTANTS.ALL_UPDATE_TYPES))), '[]'),
  /** JSON-массив никнеймов без @ (регистр не важен), например `["admin_user","boss"]`. */
  botAdmins: v.optional(
    v.pipe(
      v.string(),
      v.transform(JSON.parse),
      v.array(v.union([v.string(), v.number()])),
      v.transform(arr =>
        arr
          .map(x => (typeof x === 'number' ? String(x) : x))
          .map(s => String(s).trim().replace(/^@+/u, '').toLowerCase())
          .filter(s => s.length > 0),
      ),
    ),
    '[]',
  ),
  sheetsSpreadsheetId: v.optional(v.string(), ''),
  sheetsCredentialsJson: v.optional(v.string(), ''),
  sheetsCredentialsPath: v.optional(v.string(), ''),
  /** Лист Users (зарплата): имя листа и первая строка данных из env; бот читает A–H (роль сотрудника в H). */
  sheetsPayrollRequestsRange: v.optional(v.string(), 'Users!A2:H'),
  /** Лист JSON Calendar: … E — черновик табеля, F — одобренный табель, G — черновик запроса зарплаты. */
  sheetsJsonCalendarRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? '\'JSON Calendar\'!A2:G' : s.trim())),
    ),
    '\'JSON Calendar\'!A2:G',
  ),
  /** Лист Timesheet: строки 1–2 не используются; с 3-й — A месяц, B ник, C ФИО, D:AH дни, AI статус, AJ сумма за месяц (бот). */
  sheetsTimesheetRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? '\'Timesheet\'!A3:AJ' : s.trim())),
    ),
    '\'Timesheet\'!A3:AJ',
  ),
  /** Лист истории: A — месяц, B–H — данные; I–J пустые; K — JSON корзин дней запроса (yellow/blue/orange). */
  sheetsPaymentHistoryRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? '\'Payment History\'!A2:K' : s.trim())),
    ),
    '\'Payment History\'!A2:K',
  ),
  /** Лист Identification: A — @username, B — telegram_id, C — chat_id (новые пользователи при /start). */
  sheetsIdentificationRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? 'Identification!A2:C' : s.trim())),
    ),
    'Identification!A2:C',
  ),
  /** iikoServer: базовый URL до хоста (включая порт, без `/resto`). Пример: `https://127.0.0.1:8080` */
  iikoServerBaseUrl: v.optional(v.string(), ''),
  iikoServerLogin: v.optional(v.string(), ''),
  iikoServerPassword: v.optional(v.string(), ''),
  iikoServerTimeoutMs: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '15000'),
  /** Таймзона ресторана (IANA), для среза «вчера» и node-cron. */
  iikoServerTz: v.optional(v.string(), 'Asia/Aqtobe'),
  iikoServerMaxRetries: v.optional(
    v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(0), v.maxValue(10)),
    '3',
  ),
  iikoServerRetryBaseMs: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '500'),
  /** `true` — не проверять TLS (самоподписанный серт). Если задан `IIKO_SERVER_TLS_CA`, он приоритетнее. */
  iikoServerTlsInsecure: v.optional(
    v.pipe(v.string(), v.transform(JSON.parse), v.boolean()),
    'false',
  ),
  /** Путь к PEM (IIKO_SERVER_TLS_CA). */
  iikoServerTlsCa: v.optional(v.string(), ''),
  /**
   * Лист `Payroll`: «якорь» для `append` (без фиксированного числа строк), например `'Payroll'!A:H`.
   * Столбцы: SliceDate | EmployeeId | ФИО | Должность | Код | Ставка | RateEffectiveFrom | FetchedAt.
   */
  sheetsPayrollExportRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? `'Payroll'!A:H` : s.trim())),
    ),
    `'Payroll'!A:H`,
  ),
  /** Статус последнего успешного среза: J1 = дата `YYYY-MM-DD`, J2 = ISO-время записи. */
  sheetsPayrollSyncStatusRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? 'Payroll!J1:J2' : s.trim())),
    ),
    'Payroll!J1:J2',
  ),
  /** Cron-выражение (node-cron) для дневного среза окладов. */
  payrollCronExpr: v.optional(v.string(), '15 3 * * *'),
  /** Таймзона расписания (IANA), должна совпадать с `IIKO_SERVER_TZ` в обычной конфигурации. */
  payrollCronTz: v.optional(v.string(), 'Asia/Aqtobe'),
  /** Сдвой от «сегодня» в `IIKO_SERVER_TZ` для среза: `-1` = вчера. */
  payrollSliceOffsetDays: v.optional(v.pipe(v.string(), v.transform(Number), v.integer()), '-1'),
  /** Параллельные запросы `salary/byId` на сессию. */
  payrollConcurrency: v.optional(
    v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(100)),
    '5',
  ),
})

const configSchema = v.variant('botMode', [
  // polling config
  v.pipe(
    v.object({
      botMode: v.literal('polling'),
      ...baseConfigSchema.entries,
    }),
    v.transform(input => ({
      ...input,
      isDebug: input.debug,
      isWebhookMode: false as const,
      isPollingMode: true as const,
    })),
  ),
  // webhook config
  v.pipe(
    v.object({
      botMode: v.literal('webhook'),
      ...baseConfigSchema.entries,
      botWebhook: v.pipe(v.string(), v.url()),
      botWebhookSecret: v.pipe(v.string(), v.minLength(12)),
      serverHost: v.optional(v.string(), '0.0.0.0'),
      serverPort: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '80'),
    }),
    v.transform(input => ({
      ...input,
      isDebug: input.debug,
      isWebhookMode: true as const,
      isPollingMode: false as const,
    })),
  ),
])

try {
  process.loadEnvFile()
}
catch { // No .env file found
}

// NOTE: `valibot` + `variant` — явно дополняем типы для botAdmins.
export type Config = v.InferOutput<typeof configSchema> & {
  botAdmins: string[]
  sheetsSpreadsheetId: string
  sheetsCredentialsJson: string
  sheetsCredentialsPath: string
  sheetsPayrollRequestsRange: string
  sheetsJsonCalendarRange: string
  sheetsTimesheetRange: string
  sheetsPaymentHistoryRange: string
  sheetsIdentificationRange: string
  iikoServerBaseUrl: string
  iikoServerLogin: string
  iikoServerPassword: string
  iikoServerTimeoutMs: number
  iikoServerTz: string
  iikoServerMaxRetries: number
  iikoServerRetryBaseMs: number
  iikoServerTlsInsecure: boolean
  iikoServerTlsCa: string
  sheetsPayrollExportRange: string
  sheetsPayrollSyncStatusRange: string
  payrollCronExpr: string
  payrollCronTz: string
  payrollSliceOffsetDays: number
  payrollConcurrency: number
}
export type PollingConfig = v.InferOutput<typeof configSchema['options'][0]> & {
  botAdmins: string[]
  sheetsSpreadsheetId: string
  sheetsCredentialsJson: string
  sheetsCredentialsPath: string
  sheetsPayrollRequestsRange: string
  sheetsJsonCalendarRange: string
  sheetsTimesheetRange: string
  sheetsPaymentHistoryRange: string
  sheetsIdentificationRange: string
  iikoServerBaseUrl: string
  iikoServerLogin: string
  iikoServerPassword: string
  iikoServerTimeoutMs: number
  iikoServerTz: string
  iikoServerMaxRetries: number
  iikoServerRetryBaseMs: number
  iikoServerTlsInsecure: boolean
  iikoServerTlsCa: string
  sheetsPayrollExportRange: string
  sheetsPayrollSyncStatusRange: string
  payrollCronExpr: string
  payrollCronTz: string
  payrollSliceOffsetDays: number
  payrollConcurrency: number
}
export type WebhookConfig = v.InferOutput<typeof configSchema['options'][1]> & {
  botAdmins: string[]
  sheetsSpreadsheetId: string
  sheetsCredentialsJson: string
  sheetsCredentialsPath: string
  sheetsPayrollRequestsRange: string
  sheetsJsonCalendarRange: string
  sheetsTimesheetRange: string
  sheetsPaymentHistoryRange: string
  sheetsIdentificationRange: string
  iikoServerBaseUrl: string
  iikoServerLogin: string
  iikoServerPassword: string
  iikoServerTimeoutMs: number
  iikoServerTz: string
  iikoServerMaxRetries: number
  iikoServerRetryBaseMs: number
  iikoServerTlsInsecure: boolean
  iikoServerTlsCa: string
  sheetsPayrollExportRange: string
  sheetsPayrollSyncStatusRange: string
  payrollCronExpr: string
  payrollCronTz: string
  payrollSliceOffsetDays: number
  payrollConcurrency: number
}

export function createConfig(input: v.InferInput<typeof configSchema>) {
  return v.parse(configSchema, input)
}

export const config = createConfigFromEnvironment()

function createConfigFromEnvironment() {
  type CamelCase<S extends string> = S extends `${infer P1}_${infer P2}${infer P3}`
    ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
    : Lowercase<S>

  type KeysToCamelCase<T> = {
    [K in keyof T as CamelCase<string & K>]: T[K] extends object ? KeysToCamelCase<T[K]> : T[K]
  }

  function toCamelCase(str: string): string {
    return str.toLowerCase().replace(/_([a-z])/g, (_match, p1) => p1.toUpperCase())
  }

  function convertKeysToCamelCase<T>(obj: T): KeysToCamelCase<T> {
    const result: any = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const camelCaseKey = toCamelCase(key)
        result[camelCaseKey] = obj[key]
      }
    }
    return result
  }

  try {
    // @ts-expect-error create config from environment variables
    const config = createConfig(convertKeysToCamelCase(process.env))

    return config
  }
  catch (error) {
    throw new Error('Invalid config', {
      cause: error,
    })
  }
}
