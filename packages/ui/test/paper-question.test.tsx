import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import { PaperQuestion } from '../src'

/**
 * Paper rendering of a question. Checks that each type appears as it will
 * print (see `packages/core/src/pdf/QuestionBody.tsx`) — and above all that the
 * correct answer never reaches the paper: the composer page is the view of
 * what pupils get.
 */

const base = { points: 1, difficulty: 2 as const, blocks: [] }

const question = (content: Partial<QuestionContent> & Pick<QuestionContent, 'type' | 'payload'>) =>
  ({ ...base, ...content }) as QuestionContent

describe('PaperQuestion', () => {
  it('renders number, prompt and points as printed', () => {
    render(
      <PaperQuestion
        label="3."
        points={2.5}
        question={question({
          type: 'short_answer',
          payload: { prompt: 'Co je fotosyntéza?', answer: 'děj', acceptedAnswers: [] },
        })}
      />,
    )
    expect(screen.getByText('3.')).toBeInTheDocument()
    expect(screen.getByText('Co je fotosyntéza?')).toBeInTheDocument()
    // Decimal comma per Czech convention, same as in the PDF.
    expect(screen.getByText('(2,5 b.)')).toBeInTheDocument()
    expect(screen.getByText('Odpověď:')).toBeInTheDocument()
    // The model answer does not belong on paper.
    expect(screen.queryByText(/děj/)).not.toBeInTheDocument()
  })

  it('omits points for an ungraded test', () => {
    render(
      <PaperQuestion
        label="1."
        points={null}
        question={question({
          type: 'short_answer',
          payload: { prompt: 'Otázka?', answer: 'odpověď', acceptedAnswers: [] },
        })}
      />,
    )
    expect(screen.queryByText(/b\.\)/)).not.toBeInTheDocument()
  })

  it('an open answer gets as many lines as configured', () => {
    const { container, rerender } = render(
      <PaperQuestion
        question={question({
          type: 'open',
          payload: { prompt: 'Popiš fotosyntézu.', lines: 4, answer: 'Cukry a kyslík.' },
        })}
      />,
    )
    expect(container.querySelectorAll('[data-slot="paper-line"]')).toHaveLength(4)
    expect(screen.queryByText(/Cukry a kyslík/)).not.toBeInTheDocument()

    // The test override wins over the question's own value.
    rerender(
      <PaperQuestion
        lines={9}
        question={question({
          type: 'open',
          payload: { prompt: 'Popiš fotosyntézu.', lines: 4, answer: 'Cukry a kyslík.' },
        })}
      />,
    )
    expect(container.querySelectorAll('[data-slot="paper-line"]')).toHaveLength(9)
  })

  it('draw-and-describe leaves blank space without lines and hides the key', () => {
    const { container } = render(
      <PaperQuestion
        question={question({
          type: 'draw',
          payload: { prompt: 'Nakresli a popiš květ.', lines: 8, answer: 'Kalich, koruna, tyčinky, pestík.' },
        })}
      />,
    )
    expect(container.querySelectorAll('[data-slot="paper-line"]')).toHaveLength(0)
    expect(container.querySelector('[data-slot="paper-draw"]')).toBeInTheDocument()
    expect(screen.queryByText(/Kalich/)).not.toBeInTheDocument()
  })

  it('single choice is lettered and does not reveal the correct option', () => {
    render(
      <PaperQuestion
        question={question({
          type: 'single_choice',
          payload: {
            prompt: 'Kde probíhá fotosyntéza?',
            options: ['V kořenech', 'V chloroplastech', 'V květu'],
            correctIndex: 1,
          },
        })}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    // The gap after the letter is padding, not a character — hence the loose match.
    expect(items[0]).toHaveTextContent(/A\)\s*V kořenech/)
    expect(items[1]).toHaveTextContent(/B\)\s*V chloroplastech/)
    expect(items[2]).toHaveTextContent(/C\)\s*V květu/)
    // The correct option is not marked in the text (e.g. with an asterisk).
    expect(items[1]?.textContent).toBe('B)V chloroplastech')
  })

  it('multiple choice puts a checkbox, not a letter, next to each option', () => {
    const { container } = render(
      <PaperQuestion
        question={question({
          type: 'multi_choice',
          payload: {
            prompt: 'Co vzniká při fotosyntéze?',
            options: ['Cukry', 'Kyslík', 'Dusík'],
            correctIndices: [0, 1],
          },
        })}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Cukry')
    expect(items[0]?.textContent).not.toContain('A)')
    // Every option has a checkbox.
    expect(container.querySelectorAll('li > span[aria-hidden="true"]')).toHaveLength(3)
  })

  it('true/false is a table with ANO and NE columns', () => {
    render(
      <PaperQuestion
        question={question({
          type: 'true_false',
          payload: {
            prompt: 'Rozhodni, zda jsou tvrzení pravdivá.',
            statements: [
              { text: 'Fotosyntéza potřebuje světlo.', isTrue: true },
              { text: 'Probíhá i v noci.', isTrue: false },
            ],
          },
        })}
      />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getByText('Tvrzení')).toBeInTheDocument()
    expect(within(table).getByText('ANO')).toBeInTheDocument()
    expect(within(table).getByText('NE')).toBeInTheDocument()
    // Statements are numbered (the key uses the numbers too) with no answer filled in.
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('1. Fotosyntéza potřebuje světlo.')
    expect(rows[2]).toHaveTextContent('2. Probíhá i v noci.')
  })

  it('fill-in numbers the blanks and lists the word bank', () => {
    render(
      <PaperQuestion
        question={question({
          type: 'fill_blank',
          payload: {
            prompt: 'Doplň chybějící výrazy.',
            text: 'Rostliny přijímají ___ a vydávají ___.',
            blanks: ['oxid uhličitý', 'kyslík'],
            wordBank: ['dusík', 'kyslík'],
          },
        })}
      />,
    )
    expect(screen.getByText(/\(1\) ______________/)).toBeInTheDocument()
    expect(screen.getByText(/\(2\) ______________/)).toBeInTheDocument()
    expect(screen.getByText(/Nabídka: dusík • kyslík/)).toBeInTheDocument()
  })

  it('matching has two columns: numbers left, letters right', () => {
    render(
      <PaperQuestion
        question={question({
          type: 'matching',
          payload: {
            prompt: 'Přiřaď k sobě dvojice.',
            left: ['Chloroplast', 'Kořen'],
            right: ['příjem vody', 'fotosyntéza'],
            pairs: [
              [0, 1],
              [1, 0],
            ],
          },
        })}
      />,
    )
    expect(screen.getByText(/Do rámečku napiš písmeno/)).toBeInTheDocument()
    const lists = screen.getAllByRole('list')
    expect(within(lists[0]!).getByText(/1\. Chloroplast/)).toBeInTheDocument()
    expect(within(lists[1]!).getByText(/A\)\s*příjem vody/)).toBeInTheDocument()
    expect(within(lists[1]!).getByText(/B\)\s*fotosyntéza/)).toBeInTheDocument()
    // The correct pairs are not on paper.
    expect(screen.queryByText(/1 – B/)).not.toBeInTheDocument()
  })

  it('ordering gives each item a box and does not print the correct order', () => {
    const items = ['Klíčení', 'Růst', 'Kvetení', 'Plod']
    const { container } = render(
      <PaperQuestion
        question={question({ type: 'ordering', payload: { prompt: 'Seřaď fáze.', items } })}
      />,
    )
    expect(screen.getByText(/Do rámečku napiš pořadové číslo/)).toBeInTheDocument()
    for (const item of items) expect(screen.getByText(item)).toBeInTheDocument()
    expect(container.querySelectorAll('li > span[aria-hidden="true"]')).toHaveLength(items.length)
  })

  it('table fill numbers the empty cells', () => {
    render(
      <PaperQuestion
        question={question({
          type: 'table_fill',
          payload: {
            prompt: 'Doplň tabulku.',
            headers: ['Orgán', 'Funkce'],
            rows: [
              ['Kořen', null],
              [null, 'fotosyntéza'],
            ],
            answers: ['příjem vody', 'List'],
          },
        })}
      />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getByText('Orgán')).toBeInTheDocument()
    expect(within(table).getByText('(1)')).toBeInTheDocument()
    expect(within(table).getByText('(2)')).toBeInTheDocument()
    expect(within(table).queryByText('příjem vody')).not.toBeInTheDocument()
  })

  it('label image puts numbered lines below the image', () => {
    const { container } = render(
      <PaperQuestion
        question={question({
          type: 'label_image',
          payload: { prompt: 'Popiš části květu.', assetId: 'a1', labels: ['tyčinka', 'pestík'] },
        })}
      />,
    )
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('2.')).toBeInTheDocument()
    // The labels themselves are the answer — they must not be on paper.
    expect(screen.queryByText('tyčinka')).not.toBeInTheDocument()
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('renders an attached table and replaces an image with a captioned frame', () => {
    render(
      <PaperQuestion
        question={question({
          type: 'short_answer',
          payload: { prompt: 'Co ukazuje tabulka?', answer: 'x', acceptedAnswers: [] },
          blocks: [
            { kind: 'table', rows: [[{ text: 'Rok', header: true, blank: false }]] },
            { kind: 'image', assetId: 'a1', widthPercent: 60, caption: 'Schéma listu' },
          ],
        })}
      />,
    )
    expect(screen.getByText('Rok')).toBeInTheDocument()
    expect(screen.getByText('obrázek')).toBeInTheDocument()
    expect(screen.getByText('Schéma listu')).toBeInTheDocument()
  })

  it('two-column options from the template halve the item width', () => {
    render(
      <PaperQuestion
        style={{ optionColumns: 2 }}
        question={question({
          type: 'single_choice',
          payload: { prompt: 'Otázka?', options: ['a', 'b'], correctIndex: 0 },
        })}
      />,
    )
    expect(screen.getAllByRole('listitem')[0]).toHaveStyle({ width: '50%' })
  })
})
