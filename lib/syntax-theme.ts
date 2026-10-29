// Color-only syntax palettes: window themes change colors without re-tokenizing
// code or changing font metrics. Accent colors remain independent of syntax.
export const syntaxPalettes = {
  light: {
    foreground: '#1c1b1a',
    background: '#fffdf5',
    'token-comment': '#65665e',
    'token-keyword': '#713faf',
    'token-string': '#246b43',
    'token-string-expression': '#246b43',
    'token-constant': '#245e9b',
    'token-function': '#8b481b',
    'token-parameter': '#8b481b',
    'token-punctuation': '#605c56',
    'token-link': '#245e9b',
    'token-inserted': '#246b43',
    'token-deleted': '#ad303b',
    'token-changed': '#8b481b',
  },
  dim: {
    foreground: '#f0eee8',
    background: '#242529',
    'token-comment': '#a6a79f',
    'token-keyword': '#c9aff4',
    'token-string': '#a7cfa1',
    'token-string-expression': '#a7cfa1',
    'token-constant': '#9ac8ef',
    'token-function': '#edbd94',
    'token-parameter': '#edbd94',
    'token-punctuation': '#b5b3ad',
    'token-link': '#9ac8ef',
    'token-inserted': '#a7cfa1',
    'token-deleted': '#f0a1a9',
    'token-changed': '#edbd94',
  },
  black: {
    foreground: '#f0eee8',
    background: '#000000',
    'token-comment': '#95968e',
    'token-keyword': '#bea2e8',
    'token-string': '#9bc295',
    'token-string-expression': '#9bc295',
    'token-constant': '#8dbce2',
    'token-function': '#dfae86',
    'token-parameter': '#dfae86',
    'token-punctuation': '#aaa9a4',
    'token-link': '#8dbce2',
    'token-inserted': '#9bc295',
    'token-deleted': '#e4939c',
    'token-changed': '#dfae86',
  },
} as const;

export function syntaxThemeStyle(theme: keyof typeof syntaxPalettes) {
  return Object.fromEntries(
    Object.entries(syntaxPalettes[theme]).map(([name, value]) => [`--syntax-${name}`, value]),
  );
}
