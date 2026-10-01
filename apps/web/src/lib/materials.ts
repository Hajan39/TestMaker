/**
 * The single rule for whether a material feeds question generation. Each place
 * (topic header, generation card, materials strip) used to write its own and
 * they disagreed on counting duplicates or excluded ones — the whole app now
 * uses this one.
 */
export interface MaterialUsability {
  /** Duplicate copy of another material — generation would pull the same text twice. */
  duplicateOfId: string | null
  /** Manually excluded from generation by the teacher; stays in the topic. */
  excluded: boolean
  /** Text is suspiciously short for the page count — most likely a scan without a text layer. */
  needsOcr: boolean
}

/** Is the material used when generating questions from the topic? */
export function isUsableMaterial(material: MaterialUsability): boolean {
  return !material.duplicateOfId && !material.excluded && !material.needsOcr
}

/**
 * Below this many characters of usable text the server refuses to generate
 * (`generateForTopic`) — the topic card disables the button for the same reason
 * before the teacher would wait for a generation error.
 */
export const MIN_GENERATE_CHARS = 200
