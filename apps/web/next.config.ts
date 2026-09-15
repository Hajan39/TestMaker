import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Vlastní složka pro sestavení. Playwright ji přepíná na `.next-e2e`, aby
   * šel jeho server nad testovací databází spustit i ve chvíli, kdy nad tou
   * ostrou už běží `pnpm dev` — Next.js jinak druhý vývojový server v témže
   * adresáři odmítne spustit (zámek leží v sestavovací složce).
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Balíčky z monorepa se dodávají jako TypeScript zdroje.
  transpilePackages: ['@testmaker/core', '@testmaker/ui'],
  outputFileTracingIncludes: {
    // Fonty pro server-side render PDF musí být součástí serverless funkce.
    '/api/tests/**': ['../../packages/core/assets/fonts/**'],
  },
}

export default nextConfig
