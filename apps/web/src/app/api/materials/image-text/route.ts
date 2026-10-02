import { z } from 'zod'
import { AI_SETTINGS, isAiConfigured, transcribeImage } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { callRecorder } from '@/lib/aiUsage'
import { withScope } from '@/lib/user'
import { reportAiFailure } from '@/lib/aiFailure'

export const runtime = 'nodejs'
export const maxDuration = 60

const S = AI_SETTINGS.imageText

const bodySchema = z.object({
  /** The photo already shrunk in the browser, base64 without the `data:` prefix. */
  image: z.string().min(1).max(Math.ceil((S.maxBytes * 4) / 3) + 4),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
})

/**
 * Text of a photo (a textbook page from a phone) read by the model. The
 * exception to "only text goes to the server": the browser has no reliable
 * OCR of its own, so it sends a photo shrunk to `AI_SETTINGS.imageText` and
 * keeps only the returned text. The photo itself is never stored.
 *
 * When no model is configured or none can read the photo (quota), the answer
 * says so and the browser falls back to its own OCR.
 */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      if (!isAiConfigured()) {
        return Response.json({ error: t('library:imageText.notConfigured') }, { status: 503 })
      }
      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('library:imageText.invalid') }, { status: 400 })

      try {
        const result = await transcribeImage(
          { data: new Uint8Array(Buffer.from(parsed.data.image, 'base64')), mediaType: parsed.data.mediaType },
          { signal: request.signal, onCall: callRecorder(account, 'prepis') },
        )
        return Response.json(result)
      } catch (error) {
        // The browser falls back to its own OCR; the manager still learns why the model failed.
        const message = await reportAiFailure(account, { action: 'prepis-chyba', error })
        return Response.json({ error: message }, { status: 502 })
      }
    },
    { write: true },
  )
}
