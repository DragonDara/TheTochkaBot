import type { GoogleAuthConfig } from '#root/integrations/google-sheets.js'
import type { sheets_v4 } from 'googleapis'
import { createSheetsClient } from '#root/integrations/google-sheets.js'

export type SheetsValueInputOption = 'RAW' | 'USER_ENTERED'

export type SheetsValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'

export type SheetsInsertDataOption = 'INSERT_ROWS' | 'OVERWRITE'

export interface SheetsRepo {
  readRange: (
    spreadsheetId: string,
    range: string,
    options?: { valueRenderOption?: SheetsValueRenderOption },
  ) => Promise<string[][]>
  writeRange: (
    spreadsheetId: string,
    range: string,
    values: string[][],
    valueInputOption?: SheetsValueInputOption,
  ) => Promise<void>
  /** Дозапись вниз: `spreadsheets.values.append`, по умолчанию `INSERT_ROWS` + `USER_ENTERED`. */
  appendRange: (
    spreadsheetId: string,
    range: string,
    values: string[][],
    valueInputOption?: SheetsValueInputOption,
    insertDataOption?: SheetsInsertDataOption,
  ) => Promise<void>
  batchUpdate: (
    spreadsheetId: string,
    body: sheets_v4.Schema$BatchUpdateSpreadsheetRequest,
  ) => Promise<void>
  getSheetIdByTitle: (spreadsheetId: string, title: string) => Promise<number | null>
}

export class GoogleSheetsRepo implements SheetsRepo {
  private readonly sheets: sheets_v4.Sheets

  constructor(auth: GoogleAuthConfig) {
    this.sheets = createSheetsClient(auth)
  }

  async readRange(
    spreadsheetId: string,
    range: string,
    options?: { valueRenderOption?: SheetsValueRenderOption },
  ): Promise<string[][]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      ...(options?.valueRenderOption
        ? { valueRenderOption: options.valueRenderOption }
        : {}),
    })
    const values = res.data.values ?? []
    return values.map(row =>
      row.map((cell) => {
        if (cell === null || cell === undefined)
          return ''
        if (typeof cell === 'number')
          return String(cell)
        if (typeof cell === 'boolean')
          return cell ? 'TRUE' : 'FALSE'
        return String(cell)
      }),
    )
  }

  async writeRange(
    spreadsheetId: string,
    range: string,
    values: string[][],
    valueInputOption: SheetsValueInputOption = 'RAW',
  ): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption,
      requestBody: {
        values,
      },
    })
  }

  async appendRange(
    spreadsheetId: string,
    range: string,
    values: string[][],
    valueInputOption: SheetsValueInputOption = 'USER_ENTERED',
    insertDataOption: SheetsInsertDataOption = 'INSERT_ROWS',
  ): Promise<void> {
    if (values.length === 0)
      return
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption,
      insertDataOption,
      requestBody: { values },
    })
  }

  async batchUpdate(
    spreadsheetId: string,
    body: sheets_v4.Schema$BatchUpdateSpreadsheetRequest,
  ): Promise<void> {
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: body,
    })
  }

  async getSheetIdByTitle(spreadsheetId: string, title: string): Promise<number | null> {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title))',
    })
    const sh = res.data.sheets?.find(s => s.properties?.title === title)
    const id = sh?.properties?.sheetId
    return id === undefined || id === null ? null : id
  }
}
