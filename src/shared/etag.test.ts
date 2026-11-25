import { describe, expect, it } from 'vitest'
import { cleanEtag } from './etag'

describe('cleanEtag', () => {
  it('removes what compression and weak validators add', () => {
    expect(cleanEtag('"d41d8cd98f00b204e9800998ecf8427e-gzip"')).toBe('"d41d8cd98f00b204e9800998ecf8427e"')
    expect(cleanEtag('"abc-br"')).toBe('"abc"')
    expect(cleanEtag('W/"abc"')).toBe('"abc"')
  })
  it('leaves ordinary ETags alone', () => {
    expect(cleanEtag('"8c42a0e3-1f"')).toBe('"8c42a0e3-1f"')
    expect(cleanEtag(null)).toBeNull()
  })
})
