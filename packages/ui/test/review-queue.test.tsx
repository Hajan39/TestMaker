import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Question } from '@testmaker/core/schema'
import { ReviewQueue } from '../src'

const q = (id: string, prompt: string): Question => ({
  id,
  topicId: 't1',
  materialId: null,
  source: 'ai',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'short_answer',
  payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
  points: 1,
  difficulty: 2,
  blocks: [],
}) as Question

const questions = [q('q1', 'První otázka?'), q('q2', 'Druhá otázka?')]

describe('ReviewQueue', () => {
  it('ukáže první otázku a postup', () => {
    render(<ReviewQueue questions={questions} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('První otázka?')).toBeInTheDocument()
    expect(screen.getByText('Zbývá ke kontrole 2')).toBeInTheDocument()
  })

  it('klávesa A schválí a posune na další', async () => {
    const onApprove = vi.fn()
    render(<ReviewQueue questions={questions} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />)
    await userEvent.keyboard('a')
    expect(onApprove).toHaveBeenCalledWith('q1')
    expect(screen.getByText('Druhá otázka?')).toBeInTheDocument()
  })

  it('klávesa X zamítne', async () => {
    const onReject = vi.fn()
    render(<ReviewQueue questions={questions} onApprove={vi.fn()} onReject={onReject} onEdit={vi.fn()} onClose={vi.fn()} />)
    await userEvent.keyboard('x')
    expect(onReject).toHaveBeenCalledWith('q1')
  })

  it('po poslední otázce frontu zavře', async () => {
    const onClose = vi.fn()
    render(<ReviewQueue questions={[questions[0]!]} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('a')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape zavře frontu bez rozhodnutí', async () => {
    const onClose = vi.fn()
    const onApprove = vi.fn()
    render(<ReviewQueue questions={questions} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('ukáže doklad původu, když ho otázka má', () => {
    const withEvidence = {
      ...questions[0]!,
      evidence: { fileName: 'Dýchací soustava.odp', quote: 'Pravá plíce má tři laloky.' },
    } as Question
    render(<ReviewQueue questions={[withEvidence]} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Pravá plíce má tři laloky/)).toBeInTheDocument()
    expect(screen.getByText(/Dýchací soustava.odp/)).toBeInTheDocument()
  })

  it('při zkrácení seznamu zvenku neposkočí ani nezavře frontu předčasně', async () => {
    const three = [q('q1', 'První otázka?'), q('q2', 'Druhá otázka?'), q('q3', 'Třetí otázka?')]
    const onApprove = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <ReviewQueue questions={three} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} onClose={onClose} />,
    )
    await userEvent.keyboard('a')
    expect(onApprove).toHaveBeenCalledWith('q1')
    expect(screen.getByText('Druhá otázka?')).toBeInTheDocument()

    // Seznam se zvenku zkrátí (schválená otázka zmizela, přišel nový, kratší
    // profiltrovaný seznam) — fronta by měla zůstat na druhé otázce, ne
    // přeskočit na třetí ani se zavřít.
    rerender(
      <ReviewQueue
        questions={[three[1]!, three[2]!]}
        onApprove={onApprove}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('Druhá otázka?')).toBeInTheDocument()
    expect(screen.getByText('Zbývá ke kontrole 2')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape zavře frontu i s ohniskem v textovém poli', async () => {
    const onClose = vi.fn()
    const onApprove = vi.fn()
    render(
      <div>
        <input aria-label="poznámka" />
        <ReviewQueue questions={questions} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} onClose={onClose} />
      </div>,
    )
    const input = screen.getByLabelText('poznámka')
    await userEvent.click(input)
    await userEvent.keyboard('a')
    expect(onApprove).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
