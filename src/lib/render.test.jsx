import { describe, it, expect } from 'vitest'
import {
  htmlToPlainText,
  buildReplyTree,
  findNode,
  insertIntoTree,
  updateTreeNode,
  mergeStatusIntoRow,
  processStatusContent,
} from './render.jsx'

describe('htmlToPlainText', () => {
  it('separates paragraphs with newlines', () => {
    expect(htmlToPlainText('<p>one</p><p>two</p>')).toBe('one\ntwo')
  })

  it('preserves links as markdown tokens', () => {
    const out = htmlToPlainText('<p><a href="https://example.com" rel="nofollow">a site</a></p>')
    expect(out).toContain('[a site](https://example.com)')
  })

  it('leaves mention and hashtag anchors alone', () => {
    const out = htmlToPlainText('<p><a class="mention" href="x">@bob</a> <a class="hashtag" href="y">#tag</a></p>')
    expect(out).not.toContain('](')
    expect(out).toContain('@bob')
    expect(out).toContain('#tag')
  })

  it('drops quote-inline blocks', () => {
    expect(htmlToPlainText('<p>RE: <span class="quote-inline">bracket</span></p>')).toBe('RE:')
  })
})

describe('reply tree helpers', () => {
  const mk = (id, replyTo) => ({ id, in_reply_to_id: replyTo })

  it('builds a nested tree from a flat descendant list', () => {
    const tree = buildReplyTree([mk('b', 'a'), mk('c', 'a'), mk('d', 'b')], 'a')
    expect(tree).toHaveLength(2)
    expect(tree[0].status.id).toBe('b')
    expect(tree[0].children[0].status.id).toBe('d')
  })

  it('finds nodes at any depth', () => {
    const tree = buildReplyTree([mk('b', 'a'), mk('d', 'b')], 'a')
    expect(findNode(tree, 'd').status.id).toBe('d')
    expect(findNode(tree, 'nope')).toBe(null)
  })

  it('inserts immutably under the right parent', () => {
    const tree = buildReplyTree([mk('b', 'a')], 'a')
    expect(tree[0].children).toHaveLength(0)
    const next = insertIntoTree(tree, 'b', { status: mk('c', 'b'), children: [] })
    expect(next[0].children[0].status.id).toBe('c')
    // original untouched
    expect(tree[0].children).toHaveLength(0)
  })

  it('updates a node in place without touching siblings', () => {
    const tree = buildReplyTree([mk('b', 'a'), mk('c', 'a')], 'a')
    const updatedB = { ...tree[0].status, favourited: true }
    const next = updateTreeNode(tree, updatedB)
    expect(next[0].status.favourited).toBe(true)
    expect(next[1].status.favourited).toBeUndefined()
  })
})

describe('mergeStatusIntoRow', () => {
  const post = { id: 'p1' }
  const wrapper = { id: 'w1', reblog: { id: 'p1' } }

  it('matches plain rows by id', () => {
    const updated = { id: 'p1', favourited: true }
    expect(mergeStatusIntoRow(post, updated)).toBe(updated)
  })

  it('reaches into boost wrappers via the inner id', () => {
    const updated = { id: 'p1', favourited: true }
    expect(mergeStatusIntoRow(wrapper, updated)).toEqual({ id: 'w1', reblog: updated })
  })

  it('returns the same reference when nothing matches', () => {
    const other = { id: 'other' }
    expect(mergeStatusIntoRow(post, other)).toBe(post)
    expect(mergeStatusIntoRow(wrapper, { id: 'other' })).toBe(wrapper)
  })

  it('merges every copy when applied over a list', () => {
    const list = [{ id: 'p1' }, wrapper, { id: 'zzz' }]
    const updated = { id: 'p1', reblogged: true }
    const next = list.map((row) => mergeStatusIntoRow(row, updated))
    expect(next[0]).toBe(updated)
    expect(next[1].reblog).toBe(updated)
    expect(next[2]).toBe(list[2])
  })
})

describe('processStatusContent quarantined-image recovery', () => {
  const instanceUrl = 'https://inst.example'

  it('extracts bare instance-hosted image URLs as blurred attachments', () => {
    const out = processStatusContent({
      content: '<p>look https://inst.example/media/pic.jpg nice</p>',
      account: { acct: 'someone@remote.example' },
    }, instanceUrl)
    expect(out.attachments).toHaveLength(1)
    expect(out.attachments[0].url).toBe('https://inst.example/media/pic.jpg')
    expect(out.sensitive).toBe(true)
    expect(out.textNodes.join('')).not.toContain('pic.jpg')
  })

  it('strips markdown-wrapped image links entirely (no []() residue)', () => {
    const out = processStatusContent({
      content: '<p>[ ](https://inst.example/media/pic.jpg)</p>',
      account: { acct: 'someone' },
    }, instanceUrl)
    expect(out.attachments).toHaveLength(1)
    const text = out.textNodes.map((n) => (typeof n === 'string' ? n : '')).join('')
    expect(text).not.toContain('[]()')
    expect(text.trim()).toBe('')
  })

  it('recovers poster-domain images too', () => {
    const out = processStatusContent({
      content: '<p>[cat](https://remote.example/f/cat.png)</p>',
      account: { acct: 'someone@remote.example' },
    }, instanceUrl)
    expect(out.attachments).toHaveLength(1)
    expect(out.attachments[0].url).toBe('https://remote.example/f/cat.png')
  })

  it('keeps foreign-domain links as links, not attachments', () => {
    const out = processStatusContent({
      content: '<p><a href="https://elsewhere.org/page.html">a site</a></p>',
      account: { acct: 'someone' },
    }, instanceUrl)
    expect(out.attachments).toHaveLength(0)
  })
})
