import test from 'node:test';
import assert from 'node:assert/strict';
import {
  documentAppearanceSchema,
  documentAppearanceStyle,
  documentColorInk,
  documentThemeIds,
  normalizeDocumentAppearance,
  normalizeDocumentColor,
  resolveDocumentAccent,
  sameDocumentAppearance,
} from '../lib/document-appearance.ts';
import { fileActionSchema } from '../lib/space-files.ts';
import { actionSchema } from '../lib/profile-action-schema.ts';
import { profileFonts, profileFontStyle } from '../lib/profile-fonts.ts';
import { themeIds } from '../lib/profile-themes.ts';
import { restorePageDraft, serializePageDraft } from '../lib/page-draft.ts';
import { markdownToRichDocument, richDocumentToMarkdown } from '../lib/rich-document.ts';

function contrast(a: string, b: string) {
  function luminance(hex: string) {
    const c = hex
      .slice(1)
      .match(/../g)!
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  }
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('light is the default and equivalent appearance snapshots stay equal', () => {
  assert.equal(documentAppearanceStyle()['--paper'], '#fffdf5');
  assert.deepEqual(documentAppearanceStyle({}), documentAppearanceStyle());
  assert.ok(sameDocumentAppearance(undefined, { theme: 'light' }));
  assert.ok(
    sameDocumentAppearance(
      { bodyFont: 'serif', accent: 'mint' },
      { accent: 'mint', bodyFont: 'serif' },
    ),
  );
  assert.ok(sameDocumentAppearance({}, { background: 'paper' }));
  assert.deepEqual(normalizeDocumentAppearance({ bodyFont: undefined }), {});
  assert.equal(sameDocumentAppearance({}, { theme: 'black' }), false);
});

test('legacy colors map to readable presets while preserving main color and fonts', () => {
  for (const [background, theme] of [
    ['#000', 'black'],
    ['#111111', 'dim'],
    ['#123', 'dim'],
    ['paper', 'light'],
    ['#ffffff', 'light'],
  ]) {
    const migrated = normalizeDocumentAppearance({
      background,
      textColor: '#000',
      accent: '#FED',
      bodyFont: 'serif',
    });
    assert.equal(migrated.theme ?? 'light', theme);
    assert.equal(migrated.accent, '#ffeedd');
    assert.equal(migrated.bodyFont, 'serif');
    assert.ok(!('background' in migrated) && !('textColor' in migrated));
  }
  assert.equal(normalizeDocumentAppearance({ theme: 'black', background: 'paper' }).theme, 'black');
  assert.ok(sameDocumentAppearance({ background: '#000', textColor: '#fff' }, { theme: 'black' }));
});

test('every theme has readable primary and muted text with independent main colors', () => {
  for (const theme of documentThemeIds) {
    const style = documentAppearanceStyle(documentAppearanceSchema.parse({ theme }));
    assert.ok(contrast(style['--ink'], style['--paper']) >= 7, theme);
    assert.ok(contrast(style['--muted'], style['--paper']) >= 4.5, theme);
    for (const accent of [...themeIds, '#000000', '#ffffff', '#777777', '#123456', '#ff00ff']) {
      const colored = documentAppearanceStyle(documentAppearanceSchema.parse({ theme, accent }));
      const resolved = resolveDocumentAccent(accent)!;
      assert.equal(colored['--document-accent'], resolved.color);
      assert.ok(contrast(resolved.color, resolved.text) >= 4.5, `${theme}/${accent}`);
      assert.equal(colored['--paper'], style['--paper']);
      assert.equal(colored['--ink'], style['--ink']);
    }
  }
  assert.equal(documentAppearanceStyle({ theme: 'black' })['--paper'], '#000000');
});

test('main color input normalizes hex and rejects unsupported CSS at action boundaries', () => {
  assert.equal(normalizeDocumentColor(' #aBc '), '#aabbcc');
  assert.equal(documentColorInk('#000'), '#fffdf5');
  assert.equal(documentColorInk('#fff'), '#1c1b1a');
  assert.equal(resolveDocumentAccent('toString'), undefined);
  const file = { action: 'create', name: 'hello.md', content: '# Hello' };
  const page = { action: 'publish_document', expectedVersion: 1, tabId: 'home', source: '# Hello' };
  for (const appearance of [
    { theme: 'sepia' },
    { headingFont: 'remote' },
    { accent: 'lime', extra: true },
    ...['red', '#12', '#abcd', '#11223344', 'var(--ink)', 'transparent', '#fff; color: red'].map(
      (accent) => ({ accent }),
    ),
    { background: '#1234' },
    { textColor: 'var(--ink)' },
  ]) {
    assert.equal(fileActionSchema.safeParse({ ...file, appearance }).success, false);
    assert.equal(actionSchema.safeParse({ ...page, appearance }).success, false);
  }
});

test('themes and main colors survive file/page writes and draft restoration', () => {
  for (const theme of documentThemeIds) {
    const appearance = { theme, accent: '#DEF', bodyFont: 'serif' };
    const expected = normalizeDocumentAppearance(appearance);
    const file = fileActionSchema.parse({
      action: 'create',
      name: 'hello.md',
      content: '# Hello',
      appearance,
    });
    if (file.action === 'create') assert.deepEqual(file.appearance, expected);
    const page = actionSchema.parse({
      action: 'publish_document',
      expectedVersion: 1,
      tabId: 'home',
      source: '# Hello',
      appearance,
    });
    if (page.action === 'publish_document') assert.deepEqual(page.appearance, expected);
    const published = { source: '# Hello\n', appearance: {} };
    const draft = { value: { ...published, appearance: expected }, base: published };
    assert.deepEqual(restorePageDraft(JSON.parse(serializePageDraft(draft)), published), draft);
  }
});

test('FFF Forward works as a space default, document default, and inline font override', () => {
  const font = 'fff-forward';
  const profile = actionSchema.parse({ action: 'update_profile', expectedVersion: 1, font });
  assert.equal(profile.action, 'update_profile');
  if (profile.action === 'update_profile') assert.equal(profile.font, font);
  assert.deepEqual(profileFontStyle(font), {
    '--space-font-body': profileFonts[font].body,
    '--space-font-heading': profileFonts[font].heading,
  });

  const appearance = { headingFont: font, bodyFont: font } as const;
  assert.deepEqual(documentAppearanceSchema.parse(appearance), appearance);
  assert.deepEqual(documentAppearanceStyle(appearance), {
    ...documentAppearanceStyle(),
    '--document-font-heading': profileFonts[font].heading,
    '--document-font-body': profileFonts[font].body,
  });

  const source = 'Before :font[**pixel**]{family="fff-forward"} after.';
  const document = markdownToRichDocument(source);
  const styled = document.content![0].content!.find((node) => node.text === 'pixel')!;
  assert.equal(styled.marks?.find((mark) => mark.type === 'fontFamily')?.attrs?.font, font);
  assert.ok(styled.marks?.some((mark) => mark.type === 'bold'));
  styled.text = 'forward';
  const content = richDocumentToMarkdown(document, source);
  const restored = markdownToRichDocument(content);
  const restoredText = restored.content![0].content!.find((node) => node.text === 'forward')!;
  assert.equal(restoredText.marks?.find((mark) => mark.type === 'fontFamily')?.attrs?.font, font);
  assert.ok(restoredText.marks?.some((mark) => mark.type === 'bold'));

  const file = fileActionSchema.parse({ action: 'create', name: 'pixel.md', content, appearance });
  assert.equal(file.action, 'create');
  if (file.action === 'create') assert.deepEqual(file.appearance, appearance);
  const page = actionSchema.parse({
    action: 'publish_document',
    expectedVersion: 1,
    tabId: 'home',
    source: content,
    appearance,
  });
  assert.equal(page.action, 'publish_document');
  if (page.action === 'publish_document') assert.deepEqual(page.appearance, appearance);
});
