import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Builds for browser tests (custom distDir, see next.config.ts);
    // the wildcard also covers one-off folders from verification runs.
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright output (traces, screenshots). Not source code — and a running
    // test deletes it mid-scan, which crashed lint with ENOENT.
    "test-results/**",
    "playwright-report/**",
    "e2e/screenshots/**",
  ]),
]);

export default eslintConfig;
