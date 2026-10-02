/**
 * Transcribing a photo of a textbook page (or a worksheet, a board) into text
 * that becomes a material of a topic. The model only copies — no summary,
 * no corrections — because questions are later checked against verbatim
 * quotes from this text.
 */

/** What the model answers when the photo holds no readable text. */
export const IMAGE_NO_TEXT = 'BEZ_TEXTU'

export function buildImageTextSystemPrompt(): string {
  return [
    'Přepisuješ text z fotografie stránky učebnice, pracovního listu nebo tabule pro učitelku základní školy.',
    '',
    'Pravidla:',
    '1. Přepiš veškerý čitelný text doslova, v původním jazyce a pořadí čtení (sloupce zleva doprava, shora dolů).',
    '2. Nic neshrnuj, nevysvětluj ani neopravuj. Nepřidávej nic, co na fotce není.',
    '3. Nadpisy dej na samostatný řádek, odstavce odděl prázdným řádkem, odrážky zachovej jako „- “.',
    '4. Tabulku přepiš po řádcích, buňky odděl „ | “.',
    '5. Popisky obrázků a schémat přepiš, samotné obrázky nepopisuj.',
    '6. Nečitelné místo označ […].',
    `7. Když na fotce žádný text není, odpověz jen ${IMAGE_NO_TEXT}.`,
    '8. Odpověz jen přepsaným textem, bez úvodu a bez formátování Markdown.',
  ].join('\n')
}

export function buildImageTextPrompt(): string {
  return 'Přepiš text z této fotografie.'
}
