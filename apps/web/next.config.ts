import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Balíčky z monorepa se dodávají jako TypeScript zdroje.
  transpilePackages: ['@testmaker/core', '@testmaker/ui'],
  outputFileTracingIncludes: {
    // Fonty pro server-side render PDF musí být součástí serverless funkce.
    '/api/tests/**': ['../../packages/core/assets/fonts/**'],
  },
}

export default nextConfig
