import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import { PaperQuestion } from '../src'

/**
 * Papírové vykreslení otázky. Kontroluje se, že se každý typ ukáže v té
 * podobě, ve které se vytiskne (viz `packages/core/src/pdf/QuestionBody.tsx`)
 * — a hlavně že se na papír nikdy nedostane správná odpověď: stránka
 * ve skladači je pohled na to, co dostanou žáci.
 */

const base = { points: 1, difficulty: 2 as const, blocks: [] }

const question = (content: Partial<QuestionContent> & Pick<QuestionContent, 'type' | 'payload'>) =>
  ({ ...base, ...content }) as QuestionContent

describe('PaperQuestion', () => {
  it('vykreslí číslo, zadání a body tak, jak se vytisknou', () => {
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
    // Desetinná čárka podle českého úzu, stejně jako v PDF.
    expect(screen.getByText('(2,5 b.)')).toBeInTheDocument()
    expect(screen.getByText('Odpověď:')).toBeInTheDocument()
    // Vzorová odpověď na papír nepatří.
    expect(screen.queryByText(/děj/)).not.toBeInTheDocument()
  })

  it('u testu bez známek body nevypisuje', () => {
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

  it('volná odpověď dostane tolik linek, kolik je nastaveno', () => {
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

    // Přepis v testu má přednost před tím, co má otázka sama.
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

  it('výběr jedné možnosti očísluje písmeny a neprozradí správnou', () => {
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
    // Mezeru za písmenem drží odsazení, ne znak — proto volnější porovnání.
    expect(items[0]).toHaveTextContent(/A\)\s*V kořenech/)
    expect(items[1]).toHaveTextContent(/B\)\s*V chloroplastech/)
    expect(items[2]).toHaveTextContent(/C\)\s*V květu/)
    // Správná možnost není nijak odlišená textem (např. hvězdičkou).
    expect(items[1]?.textContent).toBe('B)V chloroplastech')
  })

  it('výběr více možností dá ke každé možnosti čtvereček, ne písmeno', () => {
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
    // Čtvereček na zaškrtnutí je u každé možnosti.
    expect(container.querySelectorAll('li > span[aria-hidden="true"]')).toHaveLength(3)
  })

  it('pravda/nepravda je tabulka se sloupci ANO a NE', () => {
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
    // Tvrzení jsou očíslovaná (čísla používá i klíč) a bez vyplněné odpovědi.
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('1. Fotosyntéza potřebuje světlo.')
    expect(rows[2]).toHaveTextContent('2. Probíhá i v noci.')
  })

  it('doplňování očísluje mezery a vypíše nabídku slov', () => {
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

  it('přiřazování má dva sloupce: čísla vlevo, písmena vpravo', () => {
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
    // Správné dvojice na papíře nejsou.
    expect(screen.queryByText(/1 – B/)).not.toBeInTheDocument()
  })

  it('řazení dá ke každé položce rámeček a nevypíše správné pořadí', () => {
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

  it('doplňovací tabulka očísluje prázdné buňky', () => {
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

  it('popis obrázku dá pod obrázek očíslované linky', () => {
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
    // Popisky samotné jsou odpověď — na papíře být nesmějí.
    expect(screen.queryByText('tyčinka')).not.toBeInTheDocument()
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('přílohovou tabulku vykreslí, obrázek zastoupí rámečkem s popiskem', () => {
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

  it('dvousloupcové možnosti ze šablony zúží položky na polovinu', () => {
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
