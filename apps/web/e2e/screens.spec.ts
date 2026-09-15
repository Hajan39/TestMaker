import { test } from '@playwright/test'

/**
 * Pořídí snímky hlavních obrazovek do `e2e/screenshots`, aby šlo posoudit vzhled,
 * který z kódu ani z HTML poznat nejde. Nespouští se v běžném běhu.
 */
test.describe('snímky obrazovek', () => {
  test.skip(!process.env.SCREENSHOTS, 'spouští se jen s proměnnou SCREENSHOTS')

  const shots = [
    { path: '/', name: 'knihovna', width: 1440 },
    { path: '/?grade=EKeL6hV-lr5r', name: 'rocnik', width: 1440 },
    { path: '/import', name: 'import', width: 1440 },
    { path: '/tests', name: 'testy', width: 1440 },
    { path: '/templates', name: 'sablony', width: 1440 },
    { path: '/tests/new', name: 'skladani-testu', width: 1440 },
    { path: '/', name: 'knihovna-1200', width: 1200 },
    { path: '/', name: 'knihovna-900', width: 900 },
  ]

  for (const shot of shots) {
    test(`snímek: ${shot.name}`, async ({ page }) => {
      await page.setViewportSize({ width: shot.width, height: 900 })
      await page.goto(shot.path)
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: `e2e/screenshots/${shot.name}.png`, fullPage: false })
    })
  }
})
