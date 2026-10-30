import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Shared UI also runs in the plain Vite dashboard. Native anchors are intentional.
    files: [
      'dashboard-client/**',
      'app/dashboard/**',
      'app/components/brand.tsx',
      'app/components/site-footer.tsx',
      'app/components/legal-links.tsx',
      'app/sign-out/page.tsx',
    ],
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    '.sites-runtime/**',
    '.wrangler/**',
    'dist/**',
    'out/**',
    'outputs/**',
    'work/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
