import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_TEMPLATES, templateConfigSchema } from '@testmaker/core/schema'
import { PaperHeader, PaperSheet } from '../src'

/**
 * List papíru a hlavička testu. Kontroluje se, že list vede rozměry v bodech
 * PDF (`--paper-pt`) a že hlavička vykreslí totéž co `Header` v PDF: název,
 * políčko na známku, linky k vyplnění.
 */

const config = BUILT_IN_TEMPLATES[0]!.config
const header = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

describe('PaperSheet', () => {
  it('je list ve tvaru A4 s vlastní jednotkou v bodech PDF', () => {
    const { container } = render(
      <PaperSheet config={config}>
        <p>obsah</p>
      </PaperSheet>,
    )
    const sheet = container.querySelector('[data-slot="paper-sheet"]') as HTMLElement
    expect(sheet.style.getPropertyValue('--paper-pt')).toContain('cqw')
    // Výška je poměr A4 k šířce listu (297/210 = 141,43 %).
    expect(sheet.style.minHeight).toContain('141.4')
    expect(screen.getByText('obsah')).toBeInTheDocument()
  })

  it('vykreslí zápatí, jen když ho šablona tiskne', () => {
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
  it('ukáže název, políčko na body a linky k vyplnění', () => {
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

  it('u testu bez známek políčko na známku nekreslí', () => {
    render(
      <PaperHeader title="Opakování" header={header} config={config} graded={false} totalPoints={0} />,
    )
    expect(screen.queryByText(/Body: ______/)).not.toBeInTheDocument()
  })

  it('bez názvu drží místo zástupný text, aby list nevypadal rozbitě', () => {
    render(<PaperHeader title="" header={header} config={config} graded totalPoints={0} />)
    expect(screen.getByText('Název písemky')).toBeInTheDocument()
  })

  it('schovaná hlavička se nevykreslí vůbec', () => {
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
