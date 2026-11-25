import { describe, expect, it } from 'vitest'
import { talkLinkTarget } from './notifications'

describe('talkLinkTarget', () => {
  const server = 'https://cloud.example.com'
  it('finds the conversation and the message', () => {
    expect(talkLinkTarget('https://cloud.example.com/call/abc123#message_226', server)).toEqual({
      token: 'abc123',
      messageId: 226
    })
    expect(talkLinkTarget('https://cloud.example.com/index.php/call/abc123', server)).toEqual({
      token: 'abc123',
      messageId: undefined
    })
  })

  it('leaves other links alone', () => {
    expect(talkLinkTarget('https://cloud.example.com/apps/files/?fileid=3', server)).toBeNull()
    expect(talkLinkTarget('https://other.example.com/call/abc123', server)).toBeNull()
    expect(talkLinkTarget('', server)).toBeNull()
  })
})
