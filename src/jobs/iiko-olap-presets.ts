import type { IikoOlapReportRequest } from '#root/integrations/iiko-cloud.js'

export interface IikoOlapPeriod {
  from: string
  to: string
}

export interface IikoOlapPreset {
  /** Человекочитаемое имя для логов. */
  description: string
  /** Диапазон A1 можно переопределять пер-пресет, иначе берём общий SHEETS_IIKO_OLAP_RANGE. */
  sheetsRangeEnvKey?: 'sheetsIikoOlapRange' // на будущее, если появятся отдельные листы
  /** Явный порядок колонок для листа (опционально, стабилизирует шапку). */
  sheetColumns?: string[]
  build: (deps: BuildPresetDeps) => IikoOlapReportRequest
}

export interface BuildPresetDeps {
  organizationId: string
  period: IikoOlapPeriod
}

/** Справочник пресетов. Ключи — короткие технические имена (идут в env). */
export const IIKO_OLAP_PRESETS = {
  sales_daily: {
    description: 'Продажи за вчерашний день: день + блюдо',
    sheetColumns: ['OpenDate.Typed', 'DishName', 'DishSumInt', 'DishDiscountSumInt'],
    build: ({ organizationId, period }): IikoOlapReportRequest => ({
      organizationIds: [organizationId],
      reportType: 'SALES',
      buildSummary: true,
      groupByRowFields: ['OpenDate.Typed', 'Counterparty.Name', 'PaymentType.Name'],
      aggregateFields: ['DishSumInt', 'DishCostAfterDiscount'],
      filters: {
        'OpenDate.Typed': {
          filterType: 'DateRange',
          periodType: 'CUSTOM',
          from: period.from,
          to: period.to,
        },
      },
    }),
  },

  transactions_daily: {
    description: 'Транзакции за вчерашний день',
    sheetColumns: ['DateTyped', 'AccountName', 'Sum'],
    build: ({ organizationId, period }): IikoOlapReportRequest => ({
      organizationIds: [organizationId],
      reportType: 'TRANSACTIONS',
      buildSummary: true,
      groupByRowFields: ['DateTyped', 'AccountName'],
      aggregateFields: ['Sum'],
      filters: {
        DateTyped: {
          filterType: 'DateRange',
          periodType: 'CUSTOM',
          from: period.from,
          to: period.to,
        },
      },
    }),
  },

  // ... сколько нужно пресетов
} as const satisfies Record<string, IikoOlapPreset>

export type IikoOlapPresetKey = keyof typeof IIKO_OLAP_PRESETS

export function isIikoOlapPresetKey(s: string): s is IikoOlapPresetKey {
  return Object.prototype.hasOwnProperty.call(IIKO_OLAP_PRESETS, s)
}
