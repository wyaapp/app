export type SyntaxToken = Readonly<{ from: number; to: number; color: string }>;

// Keep language metadata lightweight. Grammars and the engine live in a lazy chunk.
export const syntaxLanguages = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'json',
  'jsonc',
  'html',
  'css',
  'scss',
  'markdown',
  'shellscript',
  'python',
  'sql',
  'yaml',
  'toml',
  'xml',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'csharp',
  'diff',
  'dockerfile',
  'graphql',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'lua',
  'vue',
  'svelte',
] as const;
export type SyntaxLanguage = (typeof syntaxLanguages)[number];

const languageSet = new Set<string>(syntaxLanguages);
const aliases: Record<string, SyntaxLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  golang: 'go',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  rb: 'ruby',
  gql: 'graphql',
  docker: 'dockerfile',
  kt: 'kotlin',
  svg: 'xml',
};

export function normalizeCodeLanguage(value?: string | null): SyntaxLanguage | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (languageSet.has(normalized)) return normalized as SyntaxLanguage;
  return Object.hasOwn(aliases, normalized) ? aliases[normalized] : null;
}

export const syntaxLimits = {
  characters: 24_000,
  lineLength: 1_500,
  lines: 500,
  tokens: 8_000,
} as const;
