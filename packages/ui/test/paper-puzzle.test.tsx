import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { puzzleContentSchema } from '@testmaker/core/schema'
import { buildPuzzle } from '@testmaker/core/puzzle'
import { PaperPuzzle } from '../src'

/**
 * The puzzle preview must show the same as the PDF (`PuzzleBody.tsx`): a word
 * list in three columns, only words that are in the grid, and in the solution
 * a note for a word that did not fit.
 */

const words = [
  'průdušnice', 'fotosyntéza', 'chlorofyl', 'průduchy', 'bránice', 'hrtan', 'plíce', 'sklípky',
  'žebra', 'nosohltan', 'hlasivky', 'příklopka', 'kyslík', 'oxid uhličitý', 'vlásečnice',
  'červené krvinky', 'hemoglobin', 'dýchání', 'nádech', 'výdech', 'mezižeberní svaly',
]

const overfull = puzzleContentSchema.parse({
  kind: 'wordsearch',
  title: 'Přeplněná osmisměrka',
  entries: words.map((word) => ({ word, clue: `Nápověda ke slovu ${word}` })),
  payload: { cols: 6, rows: 6, seed: 'ui' },
})

describe('PaperPuzzle', () => {
  it('the word list has three columns as on paper', () => {
    const { container } = render(<PaperPuzzle puzzle={overfull} />)
    const list = container.querySelector('[data-slot="puzzle-words"]') as HTMLElement
    expect(list.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
  })

  it('a word that did not fit is hidden from pupils; marked in the solution', () => {
    const built = buildPuzzle(overfull)
    if (built.kind !== 'wordsearch') throw new Error('expected a word search')
    expect(built.wordSearch.unplaced.length).toBeGreaterThan(0)
    const missing = built.wordSearch.unplaced[0]!

    const { unmount } = render(<PaperPuzzle puzzle={overfull} built={built} />)
    expect(screen.queryByText(missing.toUpperCase())).not.toBeInTheDocument()
    expect(screen.getByText(built.wordSearch.placements[0]!.word.toUpperCase())).toBeInTheDocument()
    unmount()

    render(<PaperPuzzle puzzle={overfull} built={built} solved />)
    expect(screen.getByText(`${missing}: v mřížce není`)).toBeInTheDocument()
  })

  it('a phrase letter without a row is pre-filled, other boxes stay empty', () => {
    const puzzle = puzzleContentSchema.parse({
      kind: 'cryptogram',
      title: 'Tajenka',
      entries: [
        { word: 'plíce', clue: 'Párový orgán.' },
        { word: 'hrtan', clue: 'Orgán s hlasivkami.' },
      ],
      // No word covers "Z".
      payload: { phrase: 'PHZ', seed: 'ui' },
    })
    const { container } = render(<PaperPuzzle puzzle={puzzle} />)
    const phrase = container.querySelector('[data-slot="puzzle-rows"] > div')!
    const cells = [...phrase.querySelectorAll('span > span')].map((cell) => cell.textContent)
    expect(cells).toEqual(['', '', 'Z'])
  })
})
