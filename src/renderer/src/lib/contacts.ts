import ICAL from 'ical.js'
import { decode, element, text } from './calendars'

// Your Nextcloud address books (CardDAV): the people you keep in Nextcloud Contacts, including
// those outside the server, for inviting them and for their card.

export interface AddressBook {
  href: string
  name: string
  /** Nextcloud's own: the server's users, or the people you were recently in contact with */
  generated: 'system' | 'recent' | null
}

export interface ContactValue {
  value: string
  /** "work", "home", "cell", … */
  type?: string
}

export interface Contact {
  uid: string
  name: string
  emails: ContactValue[]
  phones: ContactValue[]
  organization?: string
  title?: string
  address?: string
  website?: string
  note?: string
  /** data: URL of the contact's picture */
  photo?: string
  /** The address book it is in */
  book: string
  recent: boolean
}

export function parseAddressBooks(xml: string): AddressBook[] {
  const books: AddressBook[] = []
  for (const response of element('response', xml)) {
    if (!element('addressbook', text('resourcetype', response)).length) continue
    const href = decode(text('href', response))
    const uri = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '')
    books.push({
      href,
      name: decode(text('displayname', response)) || uri,
      generated:
        uri === 'z-server-generated--system'
          ? 'system'
          : uri.startsWith('z-app-generated--')
            ? 'recent'
            : null
    })
  }
  return books
}

const typeOf = (p: ICAL.Property): string | undefined => {
  const t = p.getParameter('type')
  const list = (Array.isArray(t) ? t : t ? [t] : [])
    .map((x) => String(x).toLowerCase())
    .filter((x) => x !== 'pref' && x !== 'internet' && x !== 'voice')
  return list[0]
}

const values = (card: ICAL.Component, name: string): ContactValue[] =>
  card
    .getAllProperties(name)
    .map((p) => ({
      value: String(p.getFirstValue() ?? '')
        .replace(/^(mailto|tel):/i, '')
        .trim(),
      type: typeOf(p)
    }))
    .filter((v) => v.value)

function photoOf(card: ICAL.Component): string | undefined {
  const p = card.getFirstProperty('photo')
  if (!p) return undefined
  const v = String(p.getFirstValue() ?? '')
  if (v.startsWith('data:image/')) return v
  // vCard 3: PHOTO;ENCODING=b;TYPE=JPEG:<base64>
  const encoding = String(p.getParameter('encoding') ?? '').toLowerCase()
  if (encoding === 'b' || encoding === 'base64') {
    const type = String(p.getParameter('type') ?? 'jpeg').toLowerCase()
    return `data:image/${type};base64,${v.replace(/\s+/g, '')}`
  }
  return undefined
}

function addressOf(card: ICAL.Component): string | undefined {
  const v = card.getFirstPropertyValue('adr') as unknown
  if (!v) return undefined
  // post office box, extended, street, city, region, postal code, country
  const parts = (Array.isArray(v) ? v : String(v).split(';')).map((x) =>
    (Array.isArray(x) ? x.join(' ') : String(x ?? '')).trim()
  )
  const [, , street, city, region, code, country] = parts
  return (
    [street, [code, city].filter(Boolean).join(' '), region, country].filter(Boolean).join(', ') || undefined
  )
}

/** The contacts of an address book from a CardDAV REPORT */
export function parseContacts(xml: string, book: AddressBook): Contact[] {
  const contacts: Contact[] = []
  for (const response of element('response', xml)) {
    const data = decode(text('address-data', response))
    if (!data.includes('BEGIN:VCARD')) continue
    let card: ICAL.Component
    try {
      card = new ICAL.Component(ICAL.parse(data))
    } catch {
      continue
    }
    const org = card.getFirstPropertyValue('org') as unknown
    const n = card.getFirstPropertyValue('n') as unknown
    const fromN = Array.isArray(n) ? [n[1], n[0]].filter(Boolean).join(' ') : ''
    const emails = values(card, 'email')
    const name = String(card.getFirstPropertyValue('fn') ?? '').trim() || fromN || emails[0]?.value
    if (!name) continue
    contacts.push({
      uid: String(card.getFirstPropertyValue('uid') ?? `${book.href}#${contacts.length}`),
      name,
      emails,
      phones: values(card, 'tel'),
      organization:
        (Array.isArray(org)
          ? org.filter(Boolean).join(', ')
          : String(org ?? '')
              .split(';')
              .filter(Boolean)
              .join(', ')) || undefined,
      title: String(card.getFirstPropertyValue('title') ?? '') || undefined,
      address: addressOf(card),
      website: String(card.getFirstPropertyValue('url') ?? '') || undefined,
      note: String(card.getFirstPropertyValue('note') ?? '') || undefined,
      photo: photoOf(card),
      book: book.href,
      recent: book.generated === 'recent'
    })
  }
  return contacts
}

/** Contacts whose name, email, company or phone matches the search, best first */
export function searchContacts(contacts: Contact[], query: string, limit = 8): Contact[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: [number, Contact][] = []
  for (const c of contacts) {
    const name = c.name.toLowerCase()
    let score = 0
    if (name.startsWith(q)) score = 4
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 3
    else if (c.emails.some((e) => e.value.toLowerCase().startsWith(q))) score = 2
    else if (
      name.includes(q) ||
      c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
      c.organization?.toLowerCase().includes(q)
    )
      score = 1
    if (score) scored.push([score - (c.recent ? 0.5 : 0), c])
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, c]) => c)
}
