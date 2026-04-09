import { google } from 'googleapis'

export type GoogleAuthConfig =
  | { mode: 'path', credentialsPath: string }
  | { mode: 'json', credentialsJson: string }

export function createSheetsClient(auth: GoogleAuthConfig) {
  const authClient = auth.mode === 'path'
    ? new google.auth.GoogleAuth({
      keyFile: auth.credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    : new google.auth.GoogleAuth({
      credentials: JSON.parse(auth.credentialsJson),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })

  return google.sheets({ version: 'v4', auth: authClient })
}
