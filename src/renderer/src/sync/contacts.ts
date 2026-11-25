import { useEffect, useState } from 'react'
import { parseAddressBooks, parseContacts, searchContacts, type Contact } from '@renderer/lib/contacts'

// Your contacts from Nextcloud Contacts (CardDAV), read once and kept for ten minutes. The server's
// own address book of its users is left out: Hubbub knows them as people already.

const cache = new Map<string, { at: number; contacts: Promise<Contact[]> }>()

export function loadContacts(accountId: string): Promise<Contact[]> {
  const cached = cache.get(accountId)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.contacts
  const contacts = (async () => {
    const books = parseAddressBooks(await window.hubbub.addressBooks(accountId)).filter(
      (b) => b.generated !== 'system'
    )
    const all: Contact[] = []
    for (const book of books) {
      try {
        all.push(...parseContacts(await window.hubbub.contacts(accountId, book.href), book))
      } catch {
        // One address book that can't be read doesn't hide the others
      }
    }
    // Your own contacts before the recently contacted ones with the same address
    const seen = new Set<string>()
    return all
      .sort((a, b) => Number(a.recent) - Number(b.recent))
      .filter((c) => {
        const keys = c.emails.map((e) => e.value.toLowerCase())
        if (c.recent && keys.some((k) => seen.has(k))) return false
        for (const k of keys) seen.add(k)
        return true
      })
  })()
  cache.set(accountId, { at: Date.now(), contacts })
  contacts.catch(() => cache.delete(accountId))
  return contacts
}

/** The contact with this email address, or undefined */
export async function contactByEmail(accountId: string, email: string): Promise<Contact | undefined> {
  const e = email.toLowerCase()
  const list = await loadContacts(accountId).catch(() => [])
  return (
    list.find((c) => !c.recent && c.emails.some((x) => x.value.toLowerCase() === e)) ??
    list.find((c) => c.emails.some((x) => x.value.toLowerCase() === e))
  )
}

/** Contacts matching a search, as you type */
export function useContactSearch(accountId: string, query: string, limit = 6): Contact[] {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [all, setAll] = useState<Contact[] | null>(null)
  useEffect(() => {
    let current = true
    void loadContacts(accountId)
      .then((c) => current && setAll(c))
      .catch(() => current && setAll([]))
    return () => {
      current = false
    }
  }, [accountId])
  useEffect(() => setContacts(all ? searchContacts(all, query, limit) : []), [all, query, limit])
  return contacts
}
