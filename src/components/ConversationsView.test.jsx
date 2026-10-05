import { describe, it, expect } from 'vitest'
import { conversationSnippet } from './ConversationsView.jsx'

// The conversation row is a plain-text preview of the last message —
// the one surface outside the post components where a content warning
// could leak its body.
describe('conversationSnippet', () => {
  it('shows the body text for plain messages', () => {
    expect(conversationSnippet({ last_status: { content: '<p>hello there</p>' } })).toBe('hello there')
  })

  it('shows the warning instead of the body for content-warned messages', () => {
    const conv = { last_status: { content: '<p>the secret body text</p>', spoiler_text: 'big spoiler' } }
    const out = conversationSnippet(conv)
    expect(out).toBe('CW: big spoiler')
    expect(out).not.toContain('secret body')
  })

  it('falls back to the body when the spoiler is whitespace only', () => {
    const conv = { last_status: { content: '<p>visible body</p>', spoiler_text: '   ' } }
    expect(conversationSnippet(conv)).toBe('visible body')
  })

  it('masks self-mentions to @you in the snippet', () => {
    const conv = {
      last_status: {
        content: '<p>@alice hi</p>',
        mentions: [{ id: 'u1', acct: 'alice', username: 'alice' }],
      },
    }
    expect(conversationSnippet(conv, 'u1')).toBe('@you hi')
  })

  it('keeps the placeholder for attachment-only messages', () => {
    expect(conversationSnippet({ last_status: { content: '' } })).toBe('(attachment)')
  })
})
