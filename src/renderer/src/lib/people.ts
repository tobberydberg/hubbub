import type { AutocompleteResult } from '@shared/talk-types'

export interface Person {
  id: string
  name: string
  /** Usually the e-mail address */
  subline?: string
  status?: string
}

export function toPerson(r: AutocompleteResult): Person {
  return {
    id: r.id,
    name: r.label || r.id,
    subline: r.subline || undefined,
    status: Array.isArray(r.status) ? undefined : r.status?.status
  }
}

/** Lower-case and strip accents, so "ake" finds "Åke". */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function words(s: string): string[] {
  return fold(s)
    .split(/[\s.@_\-()]+/)
    .filter(Boolean)
}

/**
 * How well one search term matches a person; lower is better, -1 is no match.
 * Name prefix beats a word in the name, which beats the user id, which beats a substring;
 * the e-mail only matches on its local part or as a whole, so a shared domain doesn't match everyone.
 */
function termScore(p: Person, term: string): number {
  const name = fold(p.name)
  const id = fold(p.id)
  if (name.startsWith(term)) return 0
  if (words(p.name).some((w) => w.startsWith(term))) return 1
  if (id.startsWith(term)) return 2
  if (name.includes(term)) return 3
  if (id.includes(term)) return 4
  if (p.subline) {
    const mail = fold(p.subline)
    if (mail.startsWith(term) || (term.includes('@') && mail.includes(term))) return 5
  }
  return -1
}

/** Filters and orders people for a query; every word of the query must match. */
export function rankPeople(people: Person[], query: string): Person[] {
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean)
  const byName = (a: Person, b: Person): number => a.name.localeCompare(b.name)
  if (!terms.length) return [...people].sort(byName)
  const scored: { p: Person; score: number }[] = []
  for (const p of people) {
    let score = 0
    for (const t of terms) {
      const s = termScore(p, t)
      if (s < 0) {
        score = -1
        break
      }
      score += s
    }
    if (score >= 0) scored.push({ p, score })
  }
  return scored.sort((a, b) => a.score - b.score || byName(a.p, b.p)).map((x) => x.p)
}

/** Merges people lists, later entries updating earlier ones. */
export function mergePeople(...lists: Person[][]): Person[] {
  const map = new Map<string, Person>()
  for (const list of lists) for (const p of list) map.set(p.id, { ...map.get(p.id), ...p })
  return [...map.values()]
}
