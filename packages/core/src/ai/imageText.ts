import { generateText, type LanguageModel } from 'ai'
import { normalizeText } from '../extract/types'
import { startLadder, type AiCallListener } from './ladder'
import { buildImageTextPrompt, buildImageTextSystemPrompt, IMAGE_NO_TEXT } from './prompts/imageText'
import { describeAiConfig, getModel, readAiLadder, type AiConfig } from './provider'
import { AI_SETTINGS } from './settings'

export interface ImageTextResult {
  /** Transcribed text; empty when the photo holds no text. */
  text: string
  /** `provider:model` that read the photo. */
  model: string
}

/**
 * Reads the text of a photo with the model ladder (`AI_MODELS`). A model out
 * of quota is skipped like anywhere else; when none can read the photo the
 * error is thrown and the browser falls back to its own OCR.
 */
export async function transcribeImage(
  image: { data: Uint8Array; mediaType: string },
  options: { models?: AiConfig[]; signal?: AbortSignal; onCall?: AiCallListener } = {},
): Promise<ImageTextResult> {
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal, options.onCall)
  const models = new Map<string, LanguageModel>()
  const { value, model } = await ladder.call(async (config, meter) => {
    const key = describeAiConfig(config)
    let llm = models.get(key)
    if (!llm) {
      llm = await getModel(config)
      models.set(key, llm)
    }
    const result = await generateText({
      model: llm,
      system: buildImageTextSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: image.data, mediaType: image.mediaType },
            { type: 'text', text: buildImageTextPrompt() },
          ],
        },
      ],
      abortSignal: options.signal,
      maxRetries: AI_SETTINGS.maxRetries,
    })
    meter.usage(result.usage?.inputTokens, result.usage?.outputTokens)
    return result.text
  })
  const text = normalizeText(value)
  return { text: text === IMAGE_NO_TEXT ? '' : text, model }
}
