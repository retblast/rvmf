import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog.jsx'

const renderDialog = (props = {}) => render(
  <ConfirmDialog
    title="Enable translation?"
    confirmLabel="Enable"
    onConfirm={() => {}}
    onCancel={() => {}}
    {...props}
  >
    <p>It will download a big model.</p>
  </ConfirmDialog>
)

describe('ConfirmDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the title, message, and both buttons', () => {
    renderDialog()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Enable translation?')).toBeInTheDocument()
    expect(screen.getByText(/it will download a big model/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    renderDialog({ onConfirm })
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the close button is clicked', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when clicking inside the card', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.click(screen.getByText(/it will download a big model/i))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel on the Escape key', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
