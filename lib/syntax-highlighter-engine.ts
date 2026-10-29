import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { syntaxLimits, type SyntaxLanguage, type SyntaxToken } from './syntax-languages.ts';
import { syntaxPalettes } from './syntax-theme.ts';

// Explicit imports produce separate grammar chunks instead of the full language bundle.
const grammars = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
} satisfies Record<SyntaxLanguage, unknown>;

const themeName = 'wya-syntax';
let highlighter: ReturnType<typeof createHighlighterCore> | undefined;
const loading = new Map<SyntaxLanguage, Promise<void>>();

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: [],
    themes: [
      createCssVariablesTheme({
        name: themeName,
        variablePrefix: '--syntax-',
        variableDefaults: syntaxPalettes.light,
        fontStyle: false,
      }),
    ],
  }).catch((error: unknown) => {
    highlighter = undefined;
    throw error;
  });
  return highlighter;
}

export async function tokenizeCode(source: string, language: SyntaxLanguage) {
  const engine = await getHighlighter();
  if (!engine.getLoadedLanguages().includes(language)) {
    let load = loading.get(language);
    if (!load) {
      load = grammars[language]()
        .then((module) => engine.loadLanguage(module.default))
        .finally(() => loading.delete(language));
      loading.set(language, load);
    }
    await load;
  }
  const lines = engine.codeToTokensBase(source, {
    lang: language,
    theme: themeName,
    tokenizeMaxLineLength: syntaxLimits.lineLength,
    tokenizeTimeLimit: 500,
  });
  const tokens: SyntaxToken[] = [];
  for (const line of lines) {
    for (const token of line) {
      if (!token.content || !token.color) continue;
      const from = token.offset;
      const to = from + token.content.length;
      // Keep exact UTF-16 positions, including CRLF and astral characters.
      if (source.slice(from, to) !== token.content) return null;
      tokens.push(Object.freeze({ from, to, color: token.color }));
      if (tokens.length > syntaxLimits.tokens) return null;
    }
  }
  return Object.freeze(tokens);
}
