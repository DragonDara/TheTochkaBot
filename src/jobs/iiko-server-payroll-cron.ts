import type { PollingConfig, WebhookConfig } from '#root/config.js'
import type { Logger } from '#root/logger.js'
import type { SheetsRepo } from '#root/repos/sheets-repo.js'
import { defaultPayrollSliceDate, syncPayrollSliceToSheet } from '#root/services/payroll-slice-sync.js'
import cron from 'node-cron'

export interface PayrollCronControl {
  stop: () => void
}

type AnyCfg = PollingConfig | WebhookConfig

/**
 * Расписание: ежедневный срез вчера (или `PAYROLL_SLICE_OFFSET_DAYS`) по `PAYROLL_CRON_TZ`.
 * Lock: повторные пересечения кроном, пока идёт предыдущий прогон, пропускаются.
 */
export function startIikoServerPayrollCron(deps: {
  config: AnyCfg
  logger: Logger
  sheetsRepo: SheetsRepo
}): PayrollCronControl {
  const { config, logger, sheetsRepo } = deps
  if (!config.payrollCronExpr?.trim() || !cron.validate(config.payrollCronExpr)) {
    logger.warn(
      { expr: config.payrollCronExpr },
      'iiko payroll cron: invalid or empty PAYROLL_CRON_EXPR, scheduler not started',
    )
    return { stop: () => undefined }
  }

  let running = false
  const task = cron.schedule(
    config.payrollCronExpr,
    () => {
      if (running) {
        logger.warn('iiko payroll cron: previous run still in progress, skip')
        return
      }
      const sliceDate = defaultPayrollSliceDate(config, new Date())
      running = true
      void (async () => {
        try {
          const r = await syncPayrollSliceToSheet(
            { config, logger, sheetsRepo },
            { sliceDate, force: false },
          )
          logger.info({ msg: 'iiko payroll cron', sliceDate, result: r })
        }
        catch (e) {
          logger.error(e, 'iiko payroll cron failed')
        }
        finally {
          running = false
        }
      })()
    },
    { timezone: config.payrollCronTz, scheduled: true },
  )
  return {
    stop: () => {
      task.stop()
    },
  }
}
