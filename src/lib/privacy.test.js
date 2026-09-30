import { describe, it, expect } from 'vitest'
import { maskAccount } from './privacy.js'

const ME = { id: '1', acct: 'alice', username: 'alice', display_name: 'Alice', avatar: 'https://x.example/a.png' }
const OTHER = { id: '2', acct: 'bob', username: 'bob', display_name: 'Bob', avatar: 'https://x.example/b.png' }

describe('maskAccount', () => {
  it('masks the current user when enabled', () => {
    const masked = maskAccount(ME, '1', true)
    expect(masked).not.toBe(ME)
    expect(masked.display_name).toBe('You')
    expect(masked.username).toBe('you')
    expect(masked.acct).toBe('you')
    expect(masked.avatar).toBeNull()
    expect(masked.avatar_static).toBeNull()
    expect(masked.note).toBe('')
    expect(masked.fields).toEqual([])
  })

  it('preserves the id so profile navigation and logic keep working', () => {
    expect(maskAccount(ME, '1', true).id).toBe('1')
  })

  it('passes everyone else through untouched — same reference', () => {
    expect(maskAccount(OTHER, '1', true)).toBe(OTHER)
  })

  it('is a passthrough when the mode is off, even for the user', () => {
    expect(maskAccount(ME, '1', false)).toBe(ME)
  })

  it('is a passthrough without a session id (logged out)', () => {
    expect(maskAccount(ME, undefined, true)).toBe(ME)
  })

  it('tolerates null accounts', () => {
    expect(maskAccount(null, '1', true)).toBeNull()
  })

  it('strips bio and profile fields — they carry real names and links', () => {
    const me = {
      ...ME,
      note: '<p>Alice Anderson — alice.example.com</p>',
      fields: [{ name: 'Web', value: 'https://alice.example.com' }],
    }
    const masked = maskAccount(me, '1', true)
    expect(masked.note).toBe('')
    expect(masked.fields).toEqual([])
  })
})
