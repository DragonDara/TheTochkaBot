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
  /** Лист JSON Calendar: A — @username, B — JSON сотрудника, C — JSON пользователя (запрос суммы), D — решение по выплате (календарь). Пустая строка в env = значение по умолчанию. */
  sheetsJsonCalendarRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? '\'JSON Calendar\'!A2:D' : s.trim())),
    ),
    '\'JSON Calendar\'!A2:D',
  ),
  /** Лист истории: A — месяц, B–H — данные; I–J пустые; K — JSON ключей дней запроса (y-m-d). */
  sheetsPaymentHistoryRange: v.optional(
    v.pipe(
      v.string(),
      v.transform(s => (s.trim() === '' ? '\'Payment History\'!A2:K' : s.trim())),
    ),
    '\'Payment History\'!A2:K',
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
  sheetsPaymentHistoryRange: string
}
export type PollingConfig = v.InferOutput<typeof configSchema['options'][0]> & {
  botAdmins: string[]
  sheetsSpreadsheetId: string
  sheetsCredentialsJson: string
  sheetsCredentialsPath: string
  sheetsPayrollRequestsRange: string
  sheetsJsonCalendarRange: string
  sheetsPaymentHistoryRange: string
}
export type WebhookConfig = v.InferOutput<typeof configSchema['options'][1]> & {
  botAdmins: string[]
  sheetsSpreadsheetId: string
  sheetsCredentialsJson: string
  sheetsCredentialsPath: string
  sheetsPayrollRequestsRange: string
  sheetsJsonCalendarRange: string
  sheetsPaymentHistoryRange: string
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
