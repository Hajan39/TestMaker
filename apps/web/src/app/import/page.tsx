import { ImportClient } from './ImportClient'

export const metadata = { title: 'Import materiálů – TestMaker' }

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Import materiálů</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-600">
          Vyber složku s výukovými materiály. Text se vytáhne přímo v prohlížeči, na server se
          posílá jen text, ne soubory. Struktura složek se použije jako Předmět → Ročník → Téma.
        </p>
      </div>
      <ImportClient />
    </div>
  )
}
