import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Custom build directory. Playwright switches it to `.next-e2e` so its
   * server over the test database can start while `pnpm dev` already runs
   * over the real one — otherwise Next.js refuses a second dev server in the
   * same directory (the lock lives in the build directory).
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Monorepo packages ship as TypeScript sources.
  transpilePackages: ['@testmaker/core', '@testmaker/ui'],
  outputFileTracingIncludes: {
    // Fonts for server-side PDF rendering must be bundled into the serverless function.
    '/api/tests/**': ['../../packages/core/assets/fonts/**'],
  },
}

export default nextConfig
