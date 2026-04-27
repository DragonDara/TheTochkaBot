#!/usr/bin/env tsx

/* eslint-disable perfectionist/sort-imports -- dotenv/config must run before #root/config */

import 'dotenv/config'

import process from 'node:process'
import { config } from '#root/config.js'
import { logger } from '#root/logger.js'
import { GoogleSheetsRepo } from '#root/repos/sheets-repo.js'
import { runIikoOlapSync } from '#root/jobs/iiko-olap-sync.js'

function createSheetsRepo() {
  const spreadsheetId = config.sheetsSpreadsheetId.trim()
  const credentialsPath = config.sheetsCredentialsPath.trim()
  const credentialsJson = config.sheetsCredentialsJson.trim()

  if (!spreadsheetId || (!credentialsPath && !credentialsJson)) {
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

const sheetsRepo = createSheetsRepo()

try {
  const result = await runIikoOlapSync({ config, logger, sheetsRepo })

  if (result.error !== undefined) {
    logger.error({ result }, 'iiko:once finished with error')
    process.exit(1)
  }

  if (!result.executed) {
    logger.warn({ result }, 'iiko:once skipped (config incomplete)')
    process.exit(0)
  }

  logger.info({ result }, 'iiko:once ok')
  process.exit(0)
}
catch (error) {
  logger.error(error, 'iiko:once crashed')
  process.exit(1)
}
