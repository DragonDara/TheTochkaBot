import { GrammyError } from 'grammy'

/** Telegram 400: новая разметка совпадает с текущей — обновление не требуется. */
export function isTelegramMessageNotModifiedError(err: unknown): boolean {
  if (err instanceof GrammyError && err.error_code === 400) {
    const d = String(err.description ?? '').toLowerCase()
    return d.includes('message is not modified')
  }
  if (!err || typeof err !== 'object')
    return false
  const o = err as { error_code?: unknown, description?: unknown, message?: unknown }
  if (o.error_code !== 400)
    return false
  const text = `${String(o.description ?? '')} ${String(o.message ?? '')}`.toLowerCase()
  return text.includes('message is not modified')
}
