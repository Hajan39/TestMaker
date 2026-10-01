import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../src'

describe('Button', () => {
  it('renders the label and calls the click handler', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Vygenerovat otázky</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Vygenerovat otázky' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('a disabled button does not react', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Uložit</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
