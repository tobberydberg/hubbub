import { useEffect, useState } from 'react'
import { talk } from '@renderer/api/talk'
import { mergePeople, rankPeople, toPerson, type Person } from '@renderer/lib/people'
import { useApp } from '@renderer/store/app'

/** How many users the directory loads up front; larger servers are searched on the server as you type. */
const DIRECTORY_SIZE = 500
const SEARCH_SIZE = 50
const MAX_AGE = 5 * 60_000

interface Directory {
  people: Person[]
  loadedAt: number
  /** The server returned fewer users than asked for, so the list is complete */
  complete: boolean
}

const directories = new Map<string, Directory>()
const loading = new Map<string, Promise<Directory>>()

function withoutSelf(accountId: string, people: Person[]): Person[] {
  const self = useApp.getState().accounts[accountId]?.user?.id
  return people.filter((p) => p.id !== self)
}

/** Loads (or returns the cached) list of users on a server that the user is allowed to see. */
export function loadDirectory(accountId: string): Promise<Directory> {
  const cached = directories.get(accountId)
  if (cached && Date.now() - cached.loadedAt < MAX_AGE) return Promise.resolve(cached)
  let p = loading.get(accountId)
  if (!p) {
    p = talk(accountId)
      .autocompleteUsers('', DIRECTORY_SIZE)
      .then((r) => {
        const users = r.filter((x) => x.source === 'users').map(toPerson)
        const dir = {
          people: mergePeople(cached?.people ?? [], withoutSelf(accountId, users)),
          loadedAt: Date.now(),
          complete: r.length < DIRECTORY_SIZE
        }
        directories.set(accountId, dir)
        return dir
      })
      .finally(() => loading.delete(accountId))
    loading.set(accountId, p)
  }
  return p
}

export function cachedPeople(accountId: string): Person[] {
  return directories.get(accountId)?.people ?? []
}

/**
 * People matching a query: the directory is filtered locally (so results are stable while typing) and,
 * when the directory may be incomplete, topped up with a server-side search.
 */
export function usePeopleSearch(
  accountId: string | undefined,
  query: string
): { people: Person[]; loading: boolean; error: string | null } {
  const [people, setPeople] = useState<Person[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    const show = (): void => {
      if (!cancelled) setPeople(rankPeople(cachedPeople(accountId), query))
    }
    show()
    setBusy(true)
    const t = setTimeout(
      async () => {
        try {
          const dir = await loadDirectory(accountId)
          show()
          if (!dir.complete && query.trim()) {
            const r = await talk(accountId).autocompleteUsers(query.trim(), SEARCH_SIZE)
            const found = withoutSelf(accountId, r.filter((x) => x.source === 'users').map(toPerson))
            const d = directories.get(accountId)
            if (d) d.people = mergePeople(d.people, found)
            show()
          }
          if (!cancelled) setError(null)
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        } finally {
          if (!cancelled) setBusy(false)
        }
      },
      cachedPeople(accountId).length ? 150 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [accountId, query])

  return { people, loading: busy, error }
}
