import type { Context } from '#root/bot/context.js'
import { logHandle } from '#root/bot/helpers/logging.js'
import { canRunPayrollSliceCommand } from '#root/bot/helpers/payroll-slice-permission.js'
import { syncPayrollSliceToSheet } from '#root/services/payroll-slice-sync.js'
import { chatAction } from '@grammyjs/auto-chat-action'
import { Composer } from 'grammy'

const YMD = /^\d{4}-\d{2}-\d{2}$/u

const composer = new Composer<Context>()

const feature = composer
  .chatType('private')
  .filter(async (ctx) => {
    if (!await canRunPayrollSliceCommand(ctx)) {
      await ctx.reply(ctx.t('payroll-slice-forbidden'))
      return false
    }
    return true
  })

feature.command('payroll', logHandle('command-payroll'), chatAction('typing'), async (ctx) => {
  const text = (ctx.message?.text ?? '').replace(/^\/payroll(@\S+)?/iu, '').trim()
  if (!YMD.test(text)) {
    await ctx.reply(ctx.t('payroll-slice-usage'))
    return
  }
  const sliceDate = text
  await ctx.reply(ctx.t('payroll-slice-started', { date: sliceDate }))
  try {
    const r = await syncPayrollSliceToSheet(
      { config: ctx.config, sheetsRepo: ctx.sheetsRepo, logger: ctx.logger },
      { sliceDate, force: true },
    )
    if (r.kind === 'ok') {
      await ctx.reply(ctx.t('payroll-slice-ok', { date: sliceDate, rows: String(r.rowCount) }))
    }
    else if (r.kind === 'skipped') {
      await ctx.reply(ctx.t('payroll-slice-skipped', { reason: r.reason }))
    }
    else {
      await ctx.reply(ctx.t('payroll-slice-noop', { reason: r.reason }))
    }
  }
  catch (e) {
    ctx.logger.error(e, 'command payroll sync failed')
    await ctx.reply(ctx.t('payroll-slice-error'))
  }
})

export { composer as payrollSyncFeature }
