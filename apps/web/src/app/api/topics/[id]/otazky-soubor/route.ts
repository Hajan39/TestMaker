import { QuestionFileError } from '@testmaker/core/ai'
import { importQuestionFile } from '@/lib/questionFile'
import { withScope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

/** Imports a Claude Code question file into the topic. The request body is the file content. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(
    async (account) => {
      const { id } = await params
      try {
        const result = await importQuestionFile(account, id, await request.text())
        if (!result) return Response.json({ error: t('library:questionFile.topicNotFound') }, { status: 404 })
        return Response.json(result)
      } catch (error) {
        // Only a file content error (invalid JSON, missing question list) may
        // tell the teacher what to fix — anything else (e.g. a database outage)
        // is not a file error and must fall through as a 500, not pose as an
        // easily fixable file problem.
        if (error instanceof QuestionFileError) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    },
    { write: true },
  )
}
