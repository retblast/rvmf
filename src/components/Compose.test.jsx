import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VisibilitySelect, visibilityLabel, CharCounter } from './Compose.jsx'

describe('visibilityLabel', () => {
  it('labels standard and Mitra-specific visibilities', () => {
    expect(visibilityLabel('public')).toBe('Public')
    expect(visibilityLabel('private')).toBe('Followers only')
    expect(visibilityLabel('subscribers')).toBe('Subscribers only')
    expect(visibilityLabel('conversation')).toBe('Conversation')
  })
})

describe('VisibilitySelect', () => {
  it('renders the full option set including subscribers', () => {
    render(<VisibilitySelect value="public" onChange={() => {}} />)
    const select = screen.getByLabelText('Visibility')
    expect([...select.options].map((o) => o.value))
      .toEqual(['public', 'unlisted', 'private', 'subscribers', 'direct'])
  })

  it('displays non-standard current values that are not offered by default', () => {
    // e.g. a post inherited visibility='conversation'
    render(<VisibilitySelect value="conversation" onChange={() => {}} />)
    const values = [...screen.getByLabelText('Visibility').options].map((o) => o.value)
    expect(values[0]).toBe('conversation')
  })

  it('reports changes upward', async () => {
    const onChange = vi.fn()
    render(<VisibilitySelect value="public" onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Visibility'), 'private')
    expect(onChange).toHaveBeenCalledWith('private')
  })

  it('locks when inside a conversation', () => {
    render(<VisibilitySelect value="conversation" onChange={() => {}} locked />)
    expect(screen.getByLabelText(/Visibility \(locked/)).toBeDisabled()
  })
})

describe('CharCounter', () => {
  it('hides while empty', () => {
    const { container } = render(<CharCounter current={0} max={500} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows remaining characters', () => {
    render(<CharCounter current={120} max={500} />)
    expect(screen.getByText('380')).toBeInTheDocument()
  })

  it('flags going over the limit', () => {
    render(<CharCounter current={520} max={500} />)
    expect(screen.getByText('-20')).toHaveClass('over')
  })
})
