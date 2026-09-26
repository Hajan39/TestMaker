import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Question } from '@testmaker/core/schema'
import { QuestionPreview } from '../src'

const question: Question = {
  id: 'q1',
  topicId: 't1',
  materialId: null,
  source: 'ai',
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'short_answer',
  payload: { prompt: 'Otázka?', answer: 'odpověď', acceptedAnswers: [] },
  points: 1,
  difficulty: 2,
  blocks: [],
} as Question

describe('QuestionPreview', () => {
  it('bez showStatus neukazuje odznak stavu', () => {
    render(<QuestionPreview question={question} />)
    expect(screen.queryByText('schváleno')).not.toBeInTheDocument()
  })

  it('se showStatus odznak stavu ukáže', () => {
    render(<QuestionPreview question={question} showStatus />)
    expect(screen.getByText('schváleno')).toBeInTheDocument()
  })
})
