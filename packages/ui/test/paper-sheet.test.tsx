import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_TEMPLATES, templateConfigSchema } from '@testmaker/core/schema'
import { PaperHeader, PaperSheet } from '../src'

/**
 * The paper sheet and test header. Checks that the sheet sizes things in PDF
 * points (`--paper-pt`) and that the header renders the same as `Header` in
 * the PDF: title, grade box, lines to fill in.
 */

const config = BUILT_IN_TEMPLATES[0]!.config
const header = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

describe('PaperSheet', () => {
  it('is an A4 sheet with its own PDF point unit', () => {
    const { container } = render(
      <PaperSheet config={config}>
        <p>obsah</p>
      </PaperSheet>,
    )
    const sheet = container.querySelector('[data-slot="paper-sheet"]') as HTMLElement
    expect(sheet.style.getPropertyValue('--paper-pt')).toContain('cqw')
    // The height is the A4 ratio to the sheet width (297/210 = 141.43 %).
    expect(sheet.style.minHeight).toContain('141.4')
    expect(screen.getByText('obsah')).toBeInTheDocument()
  })

  it('renders the footer only when the template prints it', () => {
    const { container, rerender } = render(
      <PaperSheet config={config} footerLeft="Písemka · varianta A" footerRight="strana 1 / 2">
        <p>obsah</p>
      </PaperSheet>,
    )
    expect(screen.getByText('strana 1 / 2')).toBeInTheDocument()

    rerender(
      <PaperSheet
        config={templateConfigSchema.parse({ ...config, footer: false })}
        footerLeft="Písemka · varianta A"
        footerRight="strana 1 / 2"
      >
        <p>obsah</p>
      </PaperSheet>,
    )
    expect(container.querySelector('[data-slot="paper-footer"]')).toBeNull()
  })
})

describe('PaperHeader', () => {
  it('shows the title, points box and lines to fill in', () => {
    render(
      <PaperHeader
        title="Čtvrtletní písemka"
        description="Pracuj samostatně."
        header={{ ...header, teacher: 'Nováková' }}
        config={config}
        graded
        totalPoints={12.5}
      />,
    )
    expect(screen.getByText('Čtvrtletní písemka')).toBeInTheDocument()
    expect(screen.getByText('Body: ______ / 12,5')).toBeInTheDocument()
    expect(screen.getByText('Pracuj samostatně.')).toBeInTheDocument()
    expect(screen.getByText('Vyučující: Nováková')).toBeInTheDocument()
    expect(screen.getByText('Jméno a příjmení:')).toBeInTheDocument()
  })

  it('omits the grade box for an ungraded test', () => {
    render(
      <PaperHeader title="Opakování" header={header} config={config} graded={false} totalPoints={0} />,
    )
    expect(screen.queryByText(/Body: ______/)).not.toBeInTheDocument()
  })

  it('holds the place with placeholder text when untitled, so the sheet does not look broken', () => {
    render(<PaperHeader title="" header={header} config={config} graded totalPoints={0} />)
    expect(screen.getByText('Název písemky')).toBeInTheDocument()
  })

  it('a hidden header is not rendered at all', () => {
    const { container } = render(
      <PaperHeader
        title="Opakování"
        header={header}
        config={templateConfigSchema.parse({ ...config, header: { ...config.header, show: false } })}
        graded
        totalPoints={0}
      />,
    )
    expect(container.querySelector('[data-slot="paper-header"]')).toBeNull()
  })
})
