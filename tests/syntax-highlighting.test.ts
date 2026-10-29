import test from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightCode,
  normalizeCodeLanguage,
  syntaxLanguages,
  syntaxLimits,
  type SyntaxLanguage,
  type SyntaxToken,
} from '../lib/syntax-highlighting.ts';
import {
  documentAppearanceSchema,
  documentAppearanceStyle,
  documentThemeIds,
  documentThemes,
} from '../lib/document-appearance.ts';
import { themeIds } from '../lib/profile-themes.ts';

function tokenAt(tokens: readonly SyntaxToken[], position: number) {
  const token = tokens.find((token) => token.from <= position && token.to > position);
  assert.ok(token, `Missing token at source offset ${position}`);
  return token;
}

function assertSourceRanges(source: string, tokens: readonly SyntaxToken[]) {
  let cursor = 0;
  for (const token of tokens) {
    assert.ok(Number.isInteger(token.from) && Number.isInteger(token.to));
    assert.ok(token.from >= cursor && token.to > token.from && token.to <= source.length);
    assert.match(
      source.slice(cursor, token.from),
      /^[\r\n]*$/,
      'Only line endings may be uncolored',
    );
    assert.match(token.color, /^var\(--syntax-[a-z-]+, #[a-f\d]{6}\)$/i);
    cursor = token.to;
  }
  assert.match(source.slice(cursor), /^[\r\n]*$/);
  assert.equal(
    tokens.map((token) => source.slice(token.from, token.to)).join(''),
    source.replace(/[\r\n]/g, ''),
  );
}

test('Shiki identifies keywords, strings, numbers, and comments on the first highlight', async () => {
  const source = 'const answer = "hello";\nconst count = 42; // meaningful comment';
  const tokens = await highlightCode(source, 'javascript');
  assert.ok(tokens?.length);
  assertSourceRanges(source, tokens);
  assert.match(tokenAt(tokens, source.indexOf('const')).color, /--syntax-token-keyword/);
  assert.match(tokenAt(tokens, source.indexOf('hello')).color, /--syntax-token-string/);
  assert.match(tokenAt(tokens, source.indexOf('42')).color, /--syntax-token-constant/);
  assert.match(tokenAt(tokens, source.indexOf('meaningful')).color, /--syntax-token-comment/);
});

test('token offsets preserve UTF-16 characters, CRLF, blank lines, and indentation exactly', async () => {
  const source = '\tconst storm = "🌩️";\r\n\r\n  // 🌍\r\nconst after = 17;\r\n';
  const tokens = await highlightCode(source, 'js');
  assert.ok(tokens?.length);
  assertSourceRanges(source, tokens);
  const emoji = tokenAt(tokens, source.indexOf('🌩️'));
  assert.ok(source.slice(emoji.from, emoji.to).includes('🌩️'));
  assert.match(emoji.color, /--syntax-token-string/);
  assert.match(tokenAt(tokens, source.lastIndexOf('const')).color, /--syntax-token-keyword/);
  assert.match(tokenAt(tokens, source.indexOf('17')).color, /--syntax-token-constant/);
  assert.match(tokenAt(tokens, source.indexOf('🌍')).color, /--syntax-token-comment/);
  assert.ok(Object.isFrozen(tokens));
  assert.ok(tokens.every(Object.isFrozen));
});

test('language aliases share pending work and cached immutable results', async () => {
  const source = 'const sharedSyntaxCacheProbe: number = 123;';
  const first = highlightCode(source, ' ts ');
  const second = highlightCode(source, 'typescript');
  const third = highlightCode(source, 'TS');
  assert.equal(first, second, 'Concurrent aliases must not start separate grammar work');
  assert.equal(second, third);
  const tokens = await first;
  assert.ok(tokens?.length);
  assert.equal(await highlightCode(source, 'typescript'), tokens);
  assert.equal(await highlightCode(source, 'ts'), tokens);
  assert.equal(normalizeCodeLanguage('  JS '), 'javascript');
  assert.equal(normalizeCodeLanguage('bash'), 'shellscript');
  assert.equal(normalizeCodeLanguage('c++'), 'cpp');
});

test('unsupported, plain, malicious language names, and oversized input safely stay plain', async () => {
  for (const language of [
    undefined,
    null,
    '',
    'text',
    'plaintext',
    'unknown-language',
    'constructor',
    '__proto__',
    'toString',
    'javascript<script>',
    '../javascript',
  ]) {
    assert.equal(normalizeCodeLanguage(language), null);
    assert.equal(await highlightCode('const value = 1;', language), null);
  }
  for (const source of [
    '',
    'x'.repeat(syntaxLimits.characters + 1),
    'x'.repeat(syntaxLimits.lineLength + 1),
    'x\n'.repeat(syntaxLimits.lines),
  ]) {
    assert.equal(await highlightCode(source, 'js'), null);
  }
});

const examples = {
  javascript: 'const value = 1;',
  typescript: 'const value: number = 1;',
  jsx: 'const view = <div>Hello</div>;',
  tsx: 'const view: JSX.Element = <div>Hello</div>;',
  json: '{ "value": 1 }',
  jsonc: '{ "value": 1 } // comment',
  html: '<main class="page">Hello</main>',
  css: '.page { color: red; }',
  scss: '$color: red; .page { color: $color; }',
  markdown: '# Heading\n\n[Website](https://example.com)',
  shellscript: 'echo "$HOME"',
  python: 'def greet():\n    return "hello"',
  sql: 'SELECT name FROM users WHERE id = 1;',
  yaml: 'name: hello\nenabled: true',
  toml: '[page]\nname = "hello"',
  xml: '<page name="hello" />',
  rust: 'fn main() { let value = 1; }',
  go: 'package main\nfunc main() { value := 1 }',
  java: 'class Page { int value = 1; }',
  c: 'int main(void) { return 0; }',
  cpp: 'int main() { auto value = 1; }',
  csharp: 'class Page { int value = 1; }',
  diff: '@@ -1 +1 @@\n-old\n+new',
  dockerfile: 'FROM node:22\nRUN echo hello',
  graphql: 'query Page { user(id: 1) { name } }',
  ruby: 'def greet\n  "hello"\nend',
  php: '<?php echo "hello"; ?>',
  swift: 'let value: Int = 1',
  kotlin: 'val value: Int = 1',
  lua: 'local value = 1',
  vue: '<template><p>Hello</p></template>',
  svelte: '<script>let value = 1;</script>\n<p>{value}</p>',
} satisfies Record<SyntaxLanguage, string>;

test('every supported language loads its grammar and produces colored source ranges', async (t) => {
  for (const language of syntaxLanguages) {
    await t.test(language, async () => {
      const source = examples[language];
      const tokens = await highlightCode(source, language);
      assert.ok(tokens?.length, `${language} must load successfully`);
      assertSourceRanges(source, tokens);
      assert.ok(
        tokens.some((token) => token.color.includes('--syntax-token-')),
        `${language} must have syntax colors, not just plain foreground`,
      );
    });
  }
});

function contrastRatio(left: string, right: string) {
  function luminance(hex: string) {
    const channels = [1, 3, 5].map((position) => {
      const value = parseInt(hex.slice(position, position + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('all syntax colors have readable contrast on actual light, dim, and black document surfaces', () => {
  for (const theme of documentThemeIds) {
    const style = documentAppearanceStyle(documentAppearanceSchema.parse({ theme }));
    assert.equal(style['--paper'], documentThemes[theme].background);
    const syntaxColors = Object.entries(style).filter(
      ([name]) => name.startsWith('--syntax-') && name !== '--syntax-background',
    );
    assert.ok(syntaxColors.length > 1);
    for (const [name, value] of syntaxColors) {
      const ratio = contrastRatio(value, style['--paper']);
      assert.ok(ratio >= 4.5, `${theme}/${name} contrast is ${ratio.toFixed(2)}:1`);
    }
    for (const accent of [...themeIds, '#000000', '#ffffff', '#ff00ff', '#777777']) {
      const colored = documentAppearanceStyle(documentAppearanceSchema.parse({ theme, accent }));
      const coloredSyntax = Object.entries(colored).filter(
        ([name]) => name.startsWith('--syntax-') && name !== '--syntax-background',
      );
      assert.deepEqual(coloredSyntax, syntaxColors, `${theme}/${accent} changes syntax colors`);
      assert.equal(colored['--paper'], style['--paper']);
    }
  }
});
