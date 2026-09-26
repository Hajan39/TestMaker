/**
 * Jediné pravidlo pro to, jestli materiál jde do generování otázek. Dřív si
 * ho každé místo (hlavička tématu, karta generování, pruh materiálů) psalo
 * po svém a lišila se v tom, jestli počítá i duplicity nebo vynechané —
 * odsud sahá po témž pravidle celá aplikace.
 */
export interface MaterialUsability {
  /** Duplicitní kopie jiného materiálu — generování by z ní vytáhlo tentýž text podruhé. */
  duplicateOfId: string | null
  /** Ručně vyřazený z generování učitelkou; v tématu zůstává. */
  excluded: boolean
  /** Text je podezřele krátký vůči počtu stran — nejspíš sken bez textové vrstvy. */
  needsOcr: boolean
}

/** Použije se materiál při generování otázek z tématu? */
export function isUsableMaterial(material: MaterialUsability): boolean {
  return !material.duplicateOfId && !material.excluded && !material.needsOcr
}

/**
 * Pod tímhle počtem znaků použitelného textu generování na serveru odmítne
 * (`generateForTopic`) — karta v tématu tlačítko zakáže se stejným důvodem
 * ještě dřív, než by učitelka čekala na chybu z generování.
 */
export const MIN_GENERATE_CHARS = 200
