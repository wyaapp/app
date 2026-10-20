import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale } from '../lib/i18n/locale.ts';
import { createTranslator } from '../lib/i18n/translate.ts';
import { ptBR } from '../lib/i18n/pt-BR.ts';

test('explicit language preference wins over browser language', () => {
  assert.equal(resolveLocale('en', 'pt-BR,pt;q=0.9'), 'en');
  assert.equal(resolveLocale('pt-BR', 'en-US'), 'pt-BR');
});

test('browser language negotiation respects quality, exclusions and safe fallbacks', () => {
  assert.equal(resolveLocale(null, 'pt-BR,pt;q=0.9,en;q=0.8'), 'pt-BR');
  assert.equal(resolveLocale(null, 'en;q=0.5,pt-BR;q=0.9'), 'pt-BR');
  assert.equal(resolveLocale(null, 'pt-BR;q=0,en-US'), 'en');
  assert.equal(resolveLocale(null, 'fr-FR,pt-PT;q=0.5'), 'pt-BR');
  assert.equal(resolveLocale('invalid', 'en;q=NaN,pt;q=0.8'), 'pt-BR');
  assert.equal(resolveLocale('invalid', 'fr-FR,*;q=0.1'), 'en');
  assert.equal(resolveLocale(null, 'pt;q=2,en;q=0.9'), 'en');
  assert.equal(resolveLocale(), 'en');
});

test('translators are isolated by locale, preserve unknown messages and interpolate only once', () => {
  const pt = createTranslator('pt-BR');
  const en = createTranslator('en');
  assert.equal(pt('Save layout'), 'Salvar layout');
  assert.equal(en('Save layout'), 'Save layout');
  assert.equal(pt('Unknown service message'), 'Unknown service message');
  assert.equal(pt('constructor'), 'constructor');
  assert.equal(pt('Show all {count}', { count: 12 }), 'Mostrar todos (12)');
  assert.equal(en('Show all {count}', { count: 12 }), 'Show all 12');
  assert.equal(pt('Open {name}', { name: 'My game {count}' }), 'Abrir My game {count}');
  assert.equal(pt('Open {name}'), 'Abrir {name}');
});

test('Portuguese messages preserve interpolation placeholders and ASCII apostrophes', () => {
  const placeholders = (message: string) =>
    [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [source, translated] of Object.entries(ptBR)) {
    assert.deepEqual(placeholders(translated), placeholders(source), source);
    assert.equal(translated.includes('\u2019'), false, source);
    assert.equal(typeof translated, 'string');
  }
});

test('history translates actions while preserving embedded user titles and URLs', async () => {
  const { translateHistoryReason } = await import('../lib/i18n/history.ts');
  const t = createTranslator('pt-BR');
  assert.equal(translateHistoryReason('Imported tab Home', t), 'Aba Home importada');
  assert.equal(
    translateHistoryReason('Changed /game.one to /game-two', t),
    '/game.one alterado para /game-two',
  );
  assert.equal(translateHistoryReason('Updated profile', t), 'Perfil atualizado');
  assert.equal(translateHistoryReason('Unknown historical action', t), 'Unknown historical action');
});
