/**
 * The point of recording a fixture is finding out what the provider actually
 * returns. A 200 tells us nothing; the field union across the results tells us
 * which constraints can be answered for free and which need a second call.
 */

export function findRecords(body: unknown): { path: string; records: Record<string, unknown>[] } {
  let best = { path: '', records: [] as Record<string, unknown>[] }

  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      const objects = node.filter((n) => n && typeof n === 'object' && !Array.isArray(n))
      if (objects.length > best.records.length) {
        best = { path, records: objects as Record<string, unknown>[] }
      }
      node.forEach((n, i) => walk(n, `${path}[${i}]`))
      return
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
    }
  }

  walk(body, '')
  return best
}

export function fieldCoverage(records: Record<string, unknown>[]): { key: string; pct: number }[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const [k, v] of Object.entries(record)) {
      if (v === null || v === undefined || v === '') continue
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([key, n]) => ({ key, pct: Math.round((n / records.length) * 100) }))
    .sort((a, b) => b.pct - a.pct || a.key.localeCompare(b.key))
}

/** Terms that would mean a constraint is answerable natively rather than per entity. */
export const AMENITY_TERMS = [
  'laundry',
  'washer',
  'dryer',
  'in_unit',
  'parking',
  'amenit',
  'dishwasher',
  'pet',
]

export function termHits(body: unknown, terms: string[]): { term: string; hits: number }[] {
  const raw = JSON.stringify(body).toLowerCase()
  return terms.map((term) => ({
    term,
    hits: raw.split(term.toLowerCase()).length - 1,
  }))
}
