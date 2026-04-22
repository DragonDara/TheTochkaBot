import type { IikoOlapSyncDeps } from '#root/jobs/iiko-olap-sync.js'
import { runIikoOlapSync } from '#root/jobs/iiko-olap-sync.js'
import cron from 'node-cron'

export interface IikoOlapCronHandle {
  stop: () => void
}

export interface StartIikoOlapCronOptions extends IikoOlapSyncDeps {
  expression: string
  timezone: string
  runOnStart?: boolean
}

export function startIikoOlapCron(opts: StartIikoOlapCronOptions): IikoOlapCronHandle {
  const { expression, timezone, runOnStart, ...deps } = opts
  const log = deps.logger.child({ scope: 'iiko-olap-cron' })

  if (!cron.validate(expression)) {
    log.error({ expression }, 'invalid cron expression, cron disabled')
    return { stop: () => {} }
  }

  let isRunning = false
  const tick = async () => {
    if (isRunning) {
      log.warn('previous iiko OLAP sync is still running, skip this tick')
      return
    }
    isRunning = true
    try {
      await runIikoOlapSync(deps)
    }
    finally {
      isRunning = false
    }
  }

  const task = cron.schedule(expression, tick, { timezone, scheduled: true })
  log.info({ expression, timezone }, 'iiko OLAP cron started')

  if (runOnStart) {
    // Первый прогон через "мини-задержку", чтобы не мешать старту бота.
    setTimeout(() => void tick(), 5_000)
  }

  return {
    stop: () => {
      task.stop()
      log.info('iiko OLAP cron stopped')
    },
  }
}
