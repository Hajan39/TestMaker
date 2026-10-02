/**
 * Generation settings in one place. Changes here apply to questions and
 * puzzles alike, in the app and in scripts. The model and keys are set in the
 * environment (`AI_MODELS`, see `.env.example`), not here.
 */
export const AI_SETTINGS = {
  /** Ladder used when `AI_MODELS` is missing. */
  defaultModels: ['google:gemini-flash-latest'],
  /** How many times the AI SDK retries a failed call to one model on its own. */
  maxRetries: 2,
  /**
   * Longest chunk of material per call (characters). With a chunk of a few
   * pages the model works precisely; with a hundred pages it gets lost and
   * starts making things up.
   */
  maxCharsPerCall: 8_000,
  /**
   * Questions per call. The model returns a batch as a single object — the
   * bigger it is, the more work is lost when it misses the shape of one
   * question.
   *
   * Also determines the number of material chunks: generation picks only as
   * many as there are full batches (10 questions = 2 chunks = 2 calls). More
   * chunks with one question each would cover more of the material, but cost
   * up to five times more calls — and free tiers have a daily limit on calls,
   * not on questions. Topics are not always covered from the start thanks to
   * the selection shift on every further top-up (`pickChunks`).
   */
  questionsPerCall: 5,
  /**
   * How many prompts fit into the "avoid these questions" list. The list is
   * trimmed so the prompt does not grow forever for topics with a long
   * generation history — 80 items were enough while the older ones from the
   * database went first. The caller puts newly created questions of the
   * running generation first (see generate.ts), because for a topic with
   * dozens of existing questions not even the fresh ones of the running batch
   * fit into the limit. The web loads existing questions by the same number
   * (`loadAvoidPrompts`) — otherwise it would pick more than fits the prompt.
   */
  avoidLimit: 80,
  /** Longer prompts in the avoid list are trimmed — the start is enough to tell them apart. */
  avoidItemMaxLength: 100,
  /**
   * Most points taken over from the model for open answers and drawings
   * (other types compute points themselves, see `pointsByScope`). More would
   * mean a very extensive answer that a primary-school test does not have.
   */
  maxAiPoints: 5,
  /** Shortest quote fragment worth searching for in the material; shorter ones would match anywhere. */
  minEvidencePart: 8,
  /**
   * Puzzle words (`puzzleWords.ts`). Word and clue limits given by the puzzle
   * schema (`puzzleEntrySchema`) and the grid size are taken from there; only
   * the numbers of generation itself live here.
   */
  puzzleWords: {
    /**
     * Maximum characters of material sent to the model. Enough for
     * vocabulary; with more materials the budget is split among them
     * (`fitMaterials`) so the alphabetically last files do not drop out
     * entirely.
     */
    materialChars: 60_000,
    /** Chunk size used to sample a long material evenly across the text. */
    materialChunkChars: 2_000,
    /** A shorter word is found by chance anywhere in a word search. */
    minLetters: 3,
    /** A cryptogram has no grid; a longer row does not fit the page width. */
    cryptogramMaxLetters: 14,
    /** Clue length requested from the model; the hard limit comes from the schema. */
    clueTargetLength: 120,
    /** A clue that would be shorter after trimming is dropped instead. */
    clueMinTrimmedLength: 25,
    /** How many leading letters of the word are searched in the clue as a revealed root. */
    clueRootLetters: 5,
    /**
     * Two words where one is the start of the other and they differ by at
     * most this many letters are forms of the same term (kořen/kořeny,
     * Ústava/ustava).
     */
    nearDuplicateExtraLetters: 2,
    /** Most words per call — a puzzle cannot hold more anyway. */
    maxWordsPerCall: 40,
    /**
     * For a cryptogram, more words are requested than letters are missing:
     * some words get dropped (not found in the material, revealed by the
     * clue) and matching letters to words needs a reserve. Missing letters ×
     * this ratio, at least `cryptogramMinExtraWords` extra.
     */
    cryptogramExtraWordsRatio: 0.5,
    cryptogramMinExtraWords: 3,
  },
  /** Worksheets (`worksheet.ts`). The table shape and its limits come from the core schema. */
  worksheet: {
    /**
     * Maximum characters of topic material sent to the model. A worksheet is
     * one call; more text would not be covered anyway and would only make the
     * call more expensive.
     */
    materialChars: 40_000,
    /** Chunk size used to sample a long material evenly across the text. */
    materialChunkChars: 2_000,
    /** Longest own text the teacher can put into the request. */
    ownTextMax: 20_000,
    /** Longest instruction for the worksheet. */
    instructionsMax: 1_000,
    /**
     * Longest short text or fun fact from the model (characters). Longer ones
     * are dropped, not trimmed — a cut-off sentence makes no sense. Manual
     * edits are not limited by this.
     */
    textMax: 600,
    /** Fewer content items (excluding headings and instructions) are not enough for a worksheet. */
    minItems: 3,
    /** More items do not fit a worksheet for one lesson; the excess is dropped. */
    maxItems: 20,
  },
  /**
   * Text from photos (a textbook page shot on a phone). The browser shrinks
   * the photo before sending it to the model — a 12 MP HEIC would not fit the
   * request limit, and the model reads a page just as well at this size.
   */
  imageText: {
    /** Longest side of the image sent to the model (px). */
    maxSide: 2_000,
    /** JPEG quality of the shrunk image (0–1). */
    jpegQuality: 0.85,
    /** Largest accepted image on the server (bytes, before base64). Vercel caps a request at 4.5 MB. */
    maxBytes: 3_000_000,
    /** Language of the in-browser fallback OCR (Tesseract) when no model can read the photo. */
    fallbackLanguage: 'ces',
  },
} as const
