import { Text, View } from '@react-pdf/renderer'
import type { TemplateConfig } from '../schema/template'
import type { TableItemContent, TextItemVariant } from '../schema/test'
import { WORKSHEET_LAYOUT as L } from './layout'
import { sanitizeText } from './text'

const LIGHT = '0.6pt solid #999'

/**
 * Krátký text, nebo fun fact v rámečku. Vzhled rámečku (okraj, podbarvení,
 * popisek) je nastavení šablony (`config.funFact`), ne pevná podoba.
 */
export function TextBlock({ text, variant, config }: { text: string; variant: TextItemVariant; config: TemplateConfig }) {
  if (variant === 'text') {
    return <Text style={{ marginTop: L.textSpacing }}>{sanitizeText(text)}</Text>
  }
  const { label, border, shaded } = config.funFact
  return (
    <View
      style={{
        marginTop: L.blockSpacing,
        padding: L.funFactPadding,
        border: border ? '1pt solid #444' : undefined,
        backgroundColor: shaded ? '#f0f0f0' : undefined,
      }}
      wrap={false}
    >
      {label ? <Text style={{ fontWeight: 'bold' }}>{sanitizeText(label)}</Text> : null}
      <Text>{sanitizeText(text)}</Text>
    </View>
  )
}

/**
 * Tabulka k doplnění. Láme se přes stránku po řádcích a záhlaví se na každé
 * další straně zopakuje (`fixed` uvnitř obalu, který se láme). Prázdné buňky
 * mají výšku na psaní rukou; v klíči (`solved`) je v nich správná odpověď.
 */
export function TableBlock({ table, solved = false }: { table: TableItemContent; solved?: boolean }) {
  const columns = table.header.length
  const cell = (last: boolean) => ({
    flex: 1,
    padding: L.cellPadding,
    borderRight: last ? undefined : LIGHT,
  })
  return (
    <View style={{ marginTop: L.blockSpacing }}>
      {table.caption ? <Text style={{ fontWeight: 'bold' }}>{sanitizeText(table.caption)}</Text> : null}
      <View fixed style={{ flexDirection: 'row', border: LIGHT, backgroundColor: '#f0f0f0' }}>
        {table.header.map((title, c) => (
          <View key={c} style={cell(c === columns - 1)}>
            <Text style={{ fontWeight: 'bold' }}>{sanitizeText(title)}</Text>
          </View>
        ))}
      </View>
      {table.rows.map((row, r) => (
        <View
          key={r}
          wrap={false}
          style={{ flexDirection: 'row', minHeight: L.rowMinHeight, borderLeft: LIGHT, borderRight: LIGHT, borderBottom: LIGHT }}
        >
          {row.map((value, c) => (
            <View key={c} style={cell(c === columns - 1)}>
              {value.blank ? (
                solved ? <Text style={{ color: '#555', fontStyle: 'italic' }}>{sanitizeText(value.value)}</Text> : null
              ) : (
                <Text>{sanitizeText(value.value)}</Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}
