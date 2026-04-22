#!/usr/bin/env tsx
/* eslint-disable antfu/no-top-level-await */

/** Загрузка `.env` до любого импорта `#root/config` — иначе `config` читается из пустого `process.env`. */
/* eslint-disable perfectionist/sort-imports -- `dotenv/config` must run before `#root/config` is evaluated */
import 'dotenv/config'

import type { PollingConfig, WebhookConfig } from '#root/config.js'
import type { RunnerHandle } from '@grammyjs/runner'
import process from 'node:process'
import { createBot } from '#root/bot/index.js'
import { config } from '#root/config.js'
import { logger } from '#root/logger.js'
import { GoogleSheetsRepo } from '#root/repos/sheets-repo.js'
import { createServer, createServerManager } from '#root/server/index.js'
import { run } from '@grammyjs/runner'
import { startIikoOlapCron } from '#root/jobs/iiko-olap-cron.js'
import type { IikoOlapCronHandle } from '#root/jobs/iiko-olap-cron.js'
/* eslint-enable perfectionist/sort-imports */

const sheetsRepo = createSheetsRepo()

function createSheetsRepo() {
  const spreadsheetId = config.sheetsSpreadsheetId.trim()
  const credentialsPath = config.sheetsCredentialsPath.trim()
  const credentialsJson = config.sheetsCredentialsJson.trim()

  if (!spreadsheetId || (!credentialsPath && !credentialsJson)) {
    // Fallback: bot features can still run without Sheets configured.
    return {
      readRange: async () => [],
      writeRange: async () => {},
      batchUpdate: async () => {},
      clearRange: async () => {},
      getSheetIdByTitle: async () => null,
    }
  }

  const looksLikeJson = (s: string) => s.startsWith('{') || s.startsWith('[')

  return new GoogleSheetsRepo(
    credentialsPath
      ? { mode: 'path', credentialsPath }
      : looksLikeJson(credentialsJson)
        ? { mode: 'json', credentialsJson }
        : { mode: 'path', credentialsPath: credentialsJson },
  )
}

async function startPolling(config: PollingConfig) {
  const bot = createBot(config.botToken, {
    config,
    logger,
    sheetsRepo,
  })
  let runner: undefined | RunnerHandle

  await Promise.all([
    bot.init(),
    bot.api.deleteWebhook(),
  ])

  const olapCron: IikoOlapCronHandle = (() => {
    try {
      return startIikoOlapCron({
        config,
        sheetsRepo,
        logger,
        expression: config.iikoCloudOlapScheduleCron,
        timezone: config.iikoCloudOlapScheduleTimezone,
        runOnStart: config.isDebug,
      })
    }
    catch (err) {
      logger.error({ err }, 'Failed to start iiko OLAP cron')
      return { stop: () => {} }
    }
  })()

  // graceful shutdown
  onShutdown(async () => {
    logger.info('Shutdown')
    olapCron.stop()
    await runner?.stop()
  })

  // start bot
  runner = run(bot, {
    runner: {
      fetch: {
        allowed_updates: config.botAllowedUpdates,
      },
    },
  })

  logger.info({
    msg: 'Bot running...',
    username: bot.botInfo.username,
  })
}

async function startWebhook(config: WebhookConfig) {
  const bot = createBot(config.botToken, {
    config,
    logger,
    sheetsRepo,
  })
  const server = createServer({
    bot,
    config,
    logger,
  })
  const serverManager = createServerManager(server, {
    host: config.serverHost,
    port: config.serverPort,
  })

  // to prevent receiving updates before the bot is ready
  await bot.init()

  const olapCron: IikoOlapCronHandle = (() => {
    try {
      return startIikoOlapCron({
        config,
        sheetsRepo,
        logger,
        expression: config.iikoCloudOlapScheduleCron,
        timezone: config.iikoCloudOlapScheduleTimezone,
        runOnStart: config.isDebug,
      })
    }
    catch (err) {
      logger.error({ err }, 'Failed to start iiko OLAP cron')
      return { stop: () => {} }
    }
  })()

  // graceful shutdown
  onShutdown(async () => {
    logger.info('Shutdown')
    olapCron.stop()
    await serverManager.stop()
  })
  // start server
  const info = await serverManager.start()
  logger.info({
    msg: 'Server started',
    url: info.url,
  })

  // set webhook
  await bot.api.setWebhook(config.botWebhook, {
    allowed_updates: config.botAllowedUpdates,
    secret_token: config.botWebhookSecret,
  })
  logger.info({
    msg: 'Webhook was set',
    url: config.botWebhook,
  })
}

try {
  if (config.isWebhookMode)
    await startWebhook(config)
  else if (config.isPollingMode)
    await startPolling(config)
}
catch (error) {
  logger.error(error)
  process.exit(1)
}

// Utils

function onShutdown(cleanUp: () => Promise<void>) {
  let isShuttingDown = false
  const handleShutdown = async () => {
    if (isShuttingDown)
      return
    isShuttingDown = true
    await cleanUp()
  }
  process.on('SIGINT', handleShutdown)
  process.on('SIGTERM', handleShutdown)
}
