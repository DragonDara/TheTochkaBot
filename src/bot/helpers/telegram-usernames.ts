/** Ник без @, в нижнем регистре (как в Telegram для сравнения). */
export function normalizeTelegramUsername(raw: string): string {
  return raw.trim().replace(/^@+/u, '').toLowerCase()
}

/** Ключ для колонки A в таблицах (Users, JSON Calendar): публичный @username обязателен. */
export function usernameForSheetMatching(ctx: { from?: { username?: string } }): string | null {
  const u = ctx.from?.username
  if (!u)
    return null
  const n = normalizeTelegramUsername(u)
  return n || null
}

export function usernameInList(username: string | undefined, allowed: string[]): boolean {
  if (!username)
    return false
  const u = normalizeTelegramUsername(username)
  if (!u)
    return false
  return allowed.some(a => normalizeTelegramUsername(a) === u)
}

/** Для scope `chat` в setMyCommands нужен числовой id; @username → getChat. */
export async function resolveTelegramUsernamesToPrivateChatIds(
  api: { getChat: (id: string) => Promise<{ id: number }> },
  usernames: string[],
): Promise<number[]> {
  const out: number[] = []
  const seen = new Set<number>()
  for (const raw of usernames) {
    const u = normalizeTelegramUsername(raw)
    if (!u)
      continue
    try {
      const chat = await api.getChat(`@${u}`)
      if (chat.id > 0 && !seen.has(chat.id)) {
        seen.add(chat.id)
        out.push(chat.id)
      }
    }
    catch {
      // нет чата / пользователь не писал боту / неверный @
    }
  }
  return out
}
