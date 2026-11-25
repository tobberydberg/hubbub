import { describe, expect, it } from 'vitest'
import { crumbs, parseFolder } from './files'

// Shaped like Nextcloud's answer to a PROPFIND of /Documents
const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
<d:response><d:href>/remote.php/dav/files/alice/Documents/</d:href><d:propstat><d:prop>
<d:resourcetype><d:collection/></d:resourcetype><oc:fileid>10</oc:fileid><oc:permissions>RGDNVCK</oc:permissions>
</d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/alice/Documents/Plan%20%26%20budget.pdf</d:href><d:propstat><d:prop>
<d:resourcetype/><d:getcontenttype>application/pdf</d:getcontenttype><d:getcontentlength>2048</d:getcontentlength>
<d:getlastmodified>Tue, 24 Nov 2026 10:00:00 GMT</d:getlastmodified><oc:fileid>12</oc:fileid>
<nc:has-preview>true</nc:has-preview><oc:permissions>RGDNVW</oc:permissions>
</d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/alice/Documents/Archive/</d:href><d:propstat><d:prop>
<d:resourcetype><d:collection/></d:resourcetype><oc:fileid>11</oc:fileid><oc:size>4096</oc:size>
<oc:permissions>GDNVCK</oc:permissions>
</d:prop></d:propstat></d:response>
</d:multistatus>`

describe('parseFolder', () => {
  it('lists folders first, without the folder itself, with decoded paths', () => {
    const files = parseFolder(xml, 'alice')
    expect(files.map((f) => f.path)).toEqual(['/Documents/Archive', '/Documents/Plan & budget.pdf'])
    expect(files[1]).toMatchObject({
      name: 'Plan & budget.pdf',
      folder: false,
      fileId: '12',
      mime: 'application/pdf',
      size: 2048,
      hasPreview: true,
      shareable: true
    })
    expect(files[0]).toMatchObject({ folder: true, size: 4096, shareable: false })
  })
})

describe('crumbs', () => {
  it('starts at home', () => {
    expect(crumbs('/')).toEqual([{ name: 'Home', path: '/' }])
    expect(crumbs('/Documents/Archive').map((c) => c.path)).toEqual(['/', '/Documents', '/Documents/Archive'])
  })
})
