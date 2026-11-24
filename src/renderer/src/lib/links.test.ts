import { describe, expect, it } from 'vitest'
import { firstLink, referenceImageId, siteOf } from './links'

describe('firstLink', () => {
  it('finds the first web address, without trailing punctuation', () => {
    expect(firstLink('See https://example.com/a?b=1. And https://other.com')).toBe(
      'https://example.com/a?b=1'
    )
    expect(firstLink('(https://example.com/page)')).toBe('https://example.com/page')
  })

  it('reads Markdown links', () => {
    expect(firstLink('Read [the docs](https://docs.example.com/x) first')).toBe('https://docs.example.com/x')
  })

  it('leaves code alone', () => {
    expect(firstLink('Run `curl https://example.com` now')).toBeNull()
    expect(firstLink('```\nhttps://example.com\n```\nthen https://real.example.com')).toBe(
      'https://real.example.com'
    )
  })

  it('needs http or https', () => {
    expect(firstLink('ftp://example.com and example.com')).toBeNull()
  })
})

describe('preview images', () => {
  it('only takes images Nextcloud keeps for previews on this server', () => {
    const id = '9f5174deb96f74b7ef54324ecd645f7c'
    expect(
      referenceImageId(
        `https://cloud.example.com/core/references/preview/${id}`,
        'https://cloud.example.com/'
      )
    ).toBe(id)
    expect(
      referenceImageId(
        `https://cloud.example.com/index.php/core/references/preview/${id}`,
        'https://cloud.example.com'
      )
    ).toBe(id)
    expect(
      referenceImageId(`https://evil.example.com/core/references/preview/${id}`, 'https://cloud.example.com')
    ).toBeNull()
    expect(
      referenceImageId('https://cloud.example.com/some/other/image.png', 'https://cloud.example.com')
    ).toBeNull()
  })

  it('names the site', () => {
    expect(siteOf('https://www.nextcloud.com/about')).toBe('nextcloud.com')
  })
})
