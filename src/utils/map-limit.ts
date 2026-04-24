/**
 * Выполняет `fn` по каждому элементу с не более чем `limit` параллельными вызовами.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0)
    return []
  const cap = Math.max(1, Math.floor(limit))
  const out: R[] = Array.from({ length: items.length })
  let i = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(cap, items.length); w++) {
    workers.push((async () => {
      for (;;) {
        const idx = i++
        if (idx >= items.length)
          break
        out[idx] = await fn(items[idx]!, idx)
      }
    })())
  }
  await Promise.all(workers)
  return out
}
