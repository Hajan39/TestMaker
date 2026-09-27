import type { QuestionContent } from '../schema/question'

/**
 * Fráze, kterými model prozrazuje, že se otázka opírá o materiál místo toho,
 * aby stála sama ("Kteří zástupci jsou uvedeni v materiálu?"). Žák materiál
 * u písemky nemusí mít po ruce vůbec, natož při opravě — otázka na něj
 * odkazovat nesmí.
 *
 * Kontroluje se text bez diakritiky a bez rozdílu velikosti písmen, aby
 * "V materiálu" i "v materiálech" chytila stejná fráze. Vzory jsou schválně
 * vázané na slovo za předložkou (`v materiálu`, `podle textu`…), ne na holé
 * podstatné jméno — "stavební materiál" nebo "Ze kterého materiálu se
 * vyrábí sklo?" jsou běžné otázky na látku/hmotu a odkazem na zdroj nejsou.
 */
const REFERENCE_PATTERNS: RegExp[] = [
  /\bve?\s+material(u|ech)\b/,
  /\bz\s+material(u|ech)\b/,
  /\bpodle\s+material(u|ech)\b/,
  /\bve?\s+textu\b/,
  /\bz\s+textu\b/,
  /\bpodle\s+textu\b/,
  /\bvychozim\s+textu\b/,
  /\bv\s+clanku\b/,
  /\bv\s+ukazce\b/,
  /\bve?\s+zdroji\b/,
  /\bv\s+prezentaci\b/,
  /\bna\s+obrazku\b/,
  /\bv\s+tabulce\s+vyse\b/,
  /\bvyse\s+uveden\w*\b/,
  /\buveden\w*\s+v\b/,
  /\bzmine\w*\s+v\b/,
  /\bjak\s+je\s+uvedeno\b/,
  /\bviz\s+vyse\b/,
]

/** Bez diakritiky a velkých písmen — vzory výše ji tak nemusí řešit. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Odkazuje tenhle text (zadání, možnost, tvrzení…) na materiál/text/zdroj? */
function textReferencesSource(text: string): boolean {
  const normalized = normalize(text)
  return REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** Text z blocku (obrázek, tabulka), který žák u otázky vidí. */
function blockTexts(question: QuestionContent): string[] {
  return question.blocks.flatMap((block) => {
    if (block.kind === 'image') return block.caption ? [block.caption] : []
    return [...(block.caption ? [block.caption] : []), ...block.rows.flatMap((row) => row.map((cell) => cell.text))]
  })
}

/**
 * Všechen text otázky, který uvidí žák — zadání, možnosti, tvrzení, buňky
 * tabulky apod. Nepatří sem `explanation` ani `evidence` — ty čte jen
 * učitelka v klíči, žákovi se netisknou.
 */
function pupilVisibleTexts(question: QuestionContent): string[] {
  const texts: string[] = [question.payload.prompt, ...blockTexts(question)]
  switch (question.type) {
    case 'open':
    case 'short_answer':
      break
    case 'single_choice':
    case 'multi_choice':
      texts.push(...question.payload.options)
      break
    case 'true_false':
      texts.push(...question.payload.statements.map((s) => s.text))
      break
    case 'fill_blank':
      texts.push(question.payload.text, ...question.payload.wordBank)
      break
    case 'matching':
      texts.push(...question.payload.left, ...question.payload.right)
      break
    case 'ordering':
      texts.push(...question.payload.items)
      break
    case 'table_fill':
      texts.push(
        ...question.payload.headers,
        ...question.payload.rows.flatMap((row) => row.filter((cell): cell is string => cell !== null)),
      )
      break
    case 'label_image':
      texts.push(...question.payload.labels)
      break
  }
  return texts
}

/**
 * Odkazuje otázka na materiál/text/zdroj místo toho, aby stála sama? Kontrola
 * projde všechen text, který uvidí žák (`pupilVisibleTexts`) — stačí, aby
 * odkazovala jediná jeho část (třeba jedno tvrzení v pravda/nepravda).
 */
export function referencesSource(question: QuestionContent): boolean {
  return pupilVisibleTexts(question).some(textReferencesSource)
}
