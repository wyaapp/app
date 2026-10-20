import type { createTranslator } from './translate.ts';

// Stored history predates localization. Translate its known action formats,
// preserving embedded titles and URLs instead of translating user content.
const formats: [RegExp, string, string[]][] = [
  [
    /^Changed username from (@\S+) to (@\S+)$/,
    'Changed username from {from} to {to}',
    ['from', 'to'],
  ],
  [/^Changed (\/\S+) to (\/\S+)$/, 'Changed {from} to {to}', ['from', 'to']],
  [/^Added (\/\S+)$/, 'Added {url}', ['url']],
  [/^Updated (\/\S+)$/, 'Updated {url}', ['url']],
  [/^Removed (\/\S+)$/, 'Removed {url}', ['url']],
  [/^Saved games widget (\/\S+)$/, 'Saved games widget {url}', ['url']],
  [/^Grouped games into (\/\S+)$/, 'Grouped games into {url}', ['url']],
  [/^Restored revision (\d+)$/, 'Restored revision {version}', ['version']],
  [/^Imported tab ([\s\S]+)$/, 'Imported tab {name}', ['name']],
];
export function translateHistoryReason(reason: string, t: ReturnType<typeof createTranslator>) {
  for (const [pattern, message, parameters] of formats) {
    const match = reason.match(pattern);
    if (match)
      return t(
        message,
        Object.fromEntries(parameters.map((name, index) => [name, match[index + 1]])),
      );
  }
  return t(reason);
}
