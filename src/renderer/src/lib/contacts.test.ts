import { describe, expect, it } from 'vitest'
import { parseAddressBooks, parseContacts, searchContacts, type AddressBook } from './contacts'

const books = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
<d:response><d:href>/remote.php/dav/addressbooks/users/alice/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/addressbooks/users/alice/contacts/</d:href><d:propstat><d:prop><d:displayname>Contacts</d:displayname><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/addressbooks/users/alice/z-server-generated--system/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/addressbooks/users/alice/z-app-generated--contactsinteraction--recent/</d:href><d:propstat><d:prop><d:displayname>Recently contacted</d:displayname><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`

const vcard = (lines: string[]): string =>
  ['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD'].join('&#13;\n').replace(/</g, '&lt;')

const report = (cards: string[]): string =>
  `<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">${cards
    .map(
      (c, i) =>
        `<d:response><d:href>/c/${i}.vcf</d:href><d:propstat><d:prop><card:address-data>${c}</card:address-data></d:prop></d:propstat></d:response>`
    )
    .join('')}</d:multistatus>`

const book: AddressBook = { href: '/c/', name: 'Contacts', generated: null }

describe('parseAddressBooks', () => {
  it('lists address books and marks Nextcloud’s own', () => {
    expect(parseAddressBooks(books).map((b) => [b.name, b.generated])).toEqual([
      ['Contacts', null],
      ['z-server-generated--system', 'system'],
      ['Recently contacted', 'recent']
    ])
  })
})

describe('parseContacts', () => {
  it('reads names, emails, phones, company, title and address', () => {
    const [c] = parseContacts(
      report([
        vcard([
          'UID:erik-1',
          'FN:Erik Partner',
          'ORG:Partner Corp;Sales',
          'TITLE:Solutions Architect',
          'EMAIL;TYPE=WORK:erik@partner.example',
          'TEL;TYPE=CELL,VOICE:+46 70 111 22 33',
          'ADR;TYPE=WORK:;;Main Street 1;Gothenburg;;41101;Sweden',
          'URL:https://partner.example'
        ])
      ]),
      book
    )
    expect(c).toMatchObject({
      uid: 'erik-1',
      name: 'Erik Partner',
      organization: 'Partner Corp, Sales',
      title: 'Solutions Architect',
      emails: [{ value: 'erik@partner.example', type: 'work' }],
      phones: [{ value: '+46 70 111 22 33', type: 'cell' }],
      address: 'Main Street 1, 41101 Gothenburg, Sweden',
      website: 'https://partner.example'
    })
  })

  it('names a contact by N or email when FN is missing', () => {
    const list = parseContacts(
      report([vcard(['UID:a', 'N:Doe;Jane;;;']), vcard(['UID:b', 'EMAIL:x@y.example'])]),
      book
    )
    expect(list.map((c) => c.name)).toEqual(['Jane Doe', 'x@y.example'])
  })
})

describe('searchContacts', () => {
  const list = parseContacts(
    report([
      vcard(['UID:1', 'FN:Maria Customer', 'EMAIL:maria@customer.example', 'ORG:Customer AB']),
      vcard(['UID:2', 'FN:Anna Marsh', 'EMAIL:anna@x.example']),
      vcard(['UID:3', 'FN:Erik Partner', 'EMAIL:erik@partner.example'])
    ]),
    book
  )
  it('ranks name starts first, then words, emails and companies', () => {
    expect(searchContacts(list, 'mar').map((c) => c.name)).toEqual(['Maria Customer', 'Anna Marsh'])
    expect(searchContacts(list, 'customer ab').map((c) => c.name)).toEqual(['Maria Customer'])
    expect(searchContacts(list, 'erik@').map((c) => c.name)).toEqual(['Erik Partner'])
    expect(searchContacts(list, ' ')).toEqual([])
  })
})
