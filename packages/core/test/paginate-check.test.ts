import { it } from 'vitest'
import { paginate } from '../src/pdf/estimate'
import { makeItems, makeTemplate } from './fixtures'

it.runIf(process.env.RENDER_SAMPLES)('paginate odhad', () => {
  for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
    const template = makeTemplate(slug)
    const pages = paginate(makeItems(), template.config)
    console.log(slug, 'odhad stran (jen část A, bez obrázku):', pages.length, pages.map(p=>p.length))
  }
})
