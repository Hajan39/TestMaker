import { t } from '@testmaker/core/i18n'
import { BuilderLoading } from '../../tests/BuilderLoading'

export default function WorksheetLoading() {
  return <BuilderLoading label={t('worksheets:loading.worksheet')} />
}
