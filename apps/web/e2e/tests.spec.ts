import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Test list: search, template filter and copying a finished test.
 *
 * Copying exists for last year's tests — they must be reusable without
 * overwriting the original, and with the question wording printed back then.
 */

const PREFIX = 'E2E písemka'

test.describe('test list', () => {
  test('search narrows the list and stays in the URL', async ({ page }) => {
    const name = `${PREFIX} o sopkách ${Date.now()}`
    const other = `${PREFIX} o řekách ${Date.now()}`
    await createTest(page.request, name)
    await createTest(page.request, other)

    await page.goto('/tests')
    await search(page, 'o sopkách')

    const reference = page.getByRole('link', { name: name })
    await expect(reference).toBeVisible()
    await expect(page.getByRole('link', { name: other })).toHaveCount(0)

    // A link with the filter can be shared and reopened.
    const url = page.url()
    await page.goto('/tests')
    await page.goto(url)
    await expect(page.getByLabel('Hledat')).toHaveValue('o sopkách')
    await expect(page.getByRole('link', { name: name })).toBeVisible()
  })

  test('a test copy is created next to the original without overwriting it', async ({ page }) => {
    const name = `${PREFIX} ke kopírování ${Date.now()}`
    await createTest(page.request, name)

    await page.goto(`/tests?q=${encodeURIComponent(name)}`)
    await expect(page.getByRole('link', { name: name, exact: true })).toBeVisible()

    await page.getByRole('button', { name: /^Akce u testu/ }).first().click()
    await page.getByRole('menuitem', { name: 'Vytvořit kopii' }).click()

    await expect(page.getByTestId('toast-test-copied').first()).toBeVisible()

    // The list refreshes itself; the copy matches the filter because it has the
    // original title plus the "(kopie)" suffix.
    await expect(page.getByRole('link', { name: name, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: `${name} (kopie)`, exact: true })).toBeVisible()

    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    const questions = await rows.evaluateAll((rows) =>
      rows.map((row) => row.querySelectorAll('td')[1]?.textContent?.trim() ?? ''),
    )
    expect(questions[0]).toBe(questions[1])
  })

  test('the class filter narrows the list and stays in the URL', async ({ page }) => {
    const stamp = Date.now()
    const gradeA = await createGrade(page.request, `E2E předmět A ${stamp}`, `Třída A ${stamp}`)
    const gradeB = await createGrade(page.request, `E2E předmět B ${stamp}`, `Třída B ${stamp}`)
    const nameA = `${PREFIX} třídy A ${stamp}`
    const nameB = `${PREFIX} třídy B ${stamp}`
    await createTest(page.request, nameA, { gradeId: gradeA.gradeId })
    await createTest(page.request, nameB, { gradeId: gradeB.gradeId })

    await page.goto('/tests')
    await page.getByLabel('Třída').click()
    await page.getByRole('option', { name: gradeA.label }).click()

    await expect(page).toHaveURL(new RegExp(`trida=${gradeA.gradeId}`))
    await expect(page.getByRole('link', { name: nameA })).toBeVisible()
    await expect(page.getByRole('link', { name: nameB })).toHaveCount(0)

    // A link with the filter can be shared and reopened.
    const url = page.url()
    await page.goto('/tests')
    await page.goto(url)
    await expect(page.getByRole('link', { name: nameA })).toBeVisible()
    await expect(page.getByRole('link', { name: nameB })).toHaveCount(0)
  })
})

/**
 * Types the search text and waits until it shows up in the URL.
 *
 * Typing repeats until it appears in the URL: in WebKit the first letters can
 * land in the field before the page hydrates, and React never learns of them.
 */
async function search(page: Page, text: string): Promise<void> {
  const field = page.getByLabel('Hledat')
  await expect(async () => {
    // The field is cleared each time: refilling it with the same value would
    // fire no event and the wait would have nothing to wait for.
    await field.fill('')
    await field.fill(text)
    await expect(page).toHaveURL(/q=/, { timeout: 3000 })
  }).toPass({ timeout: 20_000 })
}

/** A test with one question from the bank — the first one the library has. */
async function createTest(
  request: APIRequestContext,
  title: string,
  options: { gradeId?: string } = {},
): Promise<string> {
  // `builtin-klasicka` is the built-in template that the test database seed
  // creates too — no other id can be relied on here.
  const bank = await request.get('/api/questions?status=approved&limit=1')
  expect(bank.ok()).toBe(true)
  const { items } = (await bank.json()) as { items: { id: string }[] }
  expect(items.length, 'the library has no approved questions').toBeGreaterThan(0)

  const created = await request.post('/api/tests', {
    data: {
      title,
      description: null,
      graded: true,
      templateId: 'builtin-klasicka',
      gradeId: options.gradeId ?? null,
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      showKey: true,
      items: [{ kind: 'question', questionId: items[0]!.id }],
    },
  })
  expect(created.ok(), 'failed to create the test fixture').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/**
 * Own subject and grade for the class filter — created in the library via the
 * API so the test does not depend on which classes the seeded database has now.
 */
async function createGrade(
  request: APIRequestContext,
  subjectName: string,
  gradeName: string,
): Promise<{ gradeId: string; label: string }> {
  const subject = await request.post('/api/library', { data: { kind: 'subject', name: subjectName } })
  expect(subject.ok(), 'failed to create the test subject').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }

  const grade = await request.post('/api/library', {
    data: { kind: 'grade', name: gradeName, parentId: subjectId },
  })
  expect(grade.ok(), 'failed to create the test grade').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  return { gradeId, label: `${subjectName} · ${gradeName}` }
}
