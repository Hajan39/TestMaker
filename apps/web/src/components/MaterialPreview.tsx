'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, Loader2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import type { GroupMaterial } from '@/components/MaterialRow'
import { errorMessage } from '@/lib/requestJson'
import { fetchMaterialText, queryKeys } from '@/lib/queries'

/**
 * Preview of the text the app read from a material — what generation really
 * works with. The text loads only when the dialog opens; the topic page would
 * otherwise carry every material's full text.
 */
export function MaterialPreview({ material, excluded }: { material: GroupMaterial; excluded: boolean }) {
  const [open, setOpen] = useState(false)
  const text = useQuery({
    queryKey: queryKeys.materials.text(material.id),
    queryFn: () => fetchMaterialText(material.id),
    enabled: open,
  })

  function downloadText() {
    if (text.data === undefined) return
    // The BOM lets older Windows editors recognise UTF-8 instead of showing broken diacritics.
    const url = URL.createObjectURL(new Blob(['﻿', text.data], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${material.fileName.replace(/\.[^.]+$/, '')}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0"
          aria-label={t('library:materialPreview.openAria', { name: material.fileName })}
        >
          <Eye aria-hidden />
          {t('library:materialPreview.open')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] w-full flex-col sm:max-w-3xl" data-testid="material-preview">
        <DialogHeader>
          <DialogTitle className="break-all">{material.fileName}</DialogTitle>
          <DialogDescription>{t('library:materialPreview.description')}</DialogDescription>
          <p className="text-sm text-fg-muted" data-testid="material-preview-meta">
            {t('library:materialRow.chars', { chars: material.charCount.toLocaleString('cs') })}
            {material.pageCount ? t('library:materialRow.pages', { pages: material.pageCount }) : ''}
            {material.duplicateOfId ? ` · ${t('library:materialPreview.duplicate')}` : ''}
            {!material.duplicateOfId && excluded ? ` · ${t('library:materialPreview.excluded')}` : ''}
            {material.needsOcr ? ` · ${t('library:materialRow.needsOcr')}` : ''}
          </p>
        </DialogHeader>

        <div className="min-h-32 overflow-y-auto rounded-md border border-line-soft p-4" tabIndex={0}>
          {text.isPending ? (
            <p className="text-sm text-fg-muted">
              <Loader2 className="mr-1 inline size-3.5 animate-spin" aria-hidden />
              {t('library:materialPreview.loading')}
            </p>
          ) : text.isError ? (
            <p className="text-sm text-danger" data-testid="material-preview-error">
              {errorMessage(text.error, t('library:materialPreview.loadFailed'))}
            </p>
          ) : text.data.trim() ? (
            // Paragraphs and line breaks stay as extracted; long words still wrap.
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg" data-testid="material-preview-text">
              {text.data}
            </p>
          ) : (
            <p className="text-sm text-fg-muted">{t('library:materialPreview.empty')}</p>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {material.hasOriginal ? <OriginalDownload material={material} /> : null}
          <Button variant="outline" disabled={text.data === undefined} onClick={downloadText}>
            <Download aria-hidden />
            {t('library:materialPreview.downloadText')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Download of the stored original — through our route, which checks the school. */
export function OriginalDownload({ material, compact = false }: { material: GroupMaterial; compact?: boolean }) {
  return (
    <Button asChild size={compact ? 'xs' : 'default'} variant={compact ? 'ghost' : 'outline'} className="shrink-0">
      <a
        href={`/api/materials/${encodeURIComponent(material.id)}/original`}
        download
        aria-label={t('library:materialPreview.downloadOriginalAria', { name: material.fileName })}
      >
        <Download aria-hidden />
        {t('library:materialPreview.downloadOriginal')}
      </a>
    </Button>
  )
}
