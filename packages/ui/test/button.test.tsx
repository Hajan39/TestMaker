import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../src'

describe('Button', () => {
  it('vykreslí popisek a zavolá obsluhu kliknutí', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Vygenerovat otázky</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Vygenerovat otázky' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('zakázané tlačítko nereaguje', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Uložit</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
