'use client'

import { AI_SETTINGS } from '@testmaker/core/ai/settings'
import { fileExtension, normalizeText } from '@testmaker/core/extract'
import { requestJson, jsonBody } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

const S = AI_SETTINGS.imageText

/**
 * Text of a photo (a textbook page shot on a phone, HEIC/JPEG/PNG).
 *
 * The model reads it first: it copes with a bent page, shadows and tables. When
 * no model is configured or the limits are used up, Tesseract runs right here
 * in the browser — downloaded only at that moment, so nobody pays for it
 * while the model works.
 */
export async function imageToText(file: File): Promise<string> {
  const jpeg = await shrinkToJpeg(file)
  try {
    const data = await requestJson<{ text: string }>(
      '/api/materials/image-text',
      jsonBody('POST', { image: await toBase64(jpeg), mediaType: 'image/jpeg' }),
      t('library:imageText.failed'),
    )
    if (typeof data.text === 'string') return data.text
  } catch (error) {
    // Not configured, out of quota or a model without images — the fallback decides.
    console.warn('Model could not read the photo, falling back to OCR:', error)
  }
  return normalizeText(await ocrInBrowser(jpeg))
}

/** Decodes the photo (HEIC too) and shrinks it to `maxSide` as JPEG. */
async function shrinkToJpeg(file: File): Promise<Blob> {
  const bitmap = await decode(file)
  const scale = Math.min(1, S.maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error(t('library:imageText.unreadable'))
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', S.jpegQuality))
  if (!blob) throw new Error(t('library:imageText.unreadable'))
  return blob
}

/**
 * Safari decodes HEIC itself; Chrome and Firefox cannot, so the iPhone photo
 * is converted by heic2any first (loaded only for HEIC).
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch (error) {
    if (!['heic', 'heif'].includes(fileExtension(file.name)) && !/hei[cf]/i.test(file.type)) {
      throw new Error(t('library:imageText.unreadable'), { cause: error })
    }
  }
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: S.jpegQuality })
  return createImageBitmap(Array.isArray(converted) ? converted[0]! : converted)
}

async function ocrInBrowser(image: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(S.fallbackLanguage)
  try {
    const { data } = await worker.recognize(image)
    return data.text
  } finally {
    await worker.terminate()
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
