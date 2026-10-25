export const fontIds = [
  'original',
  'system',
  'serif',
  'mono',
  'jetbrains-mono',
  'geo',
  'fff-forward',
] as const;
export type ProfileFont = (typeof fontIds)[number];

// Curated stacks only. globals.css loads Google Fonts and the bundled FFF Forward face.
export const profileFonts: Record<ProfileFont, { label: string; body: string; heading: string }> = {
  original: {
    label: 'Original',
    body: "'DM Sans', sans-serif",
    heading: "'Space Grotesk', sans-serif",
  },
  system: { label: 'Clean sans', body: 'system-ui, sans-serif', heading: 'system-ui, sans-serif' },
  serif: { label: 'Editorial', body: 'Georgia, serif', heading: 'Georgia, serif' },
  mono: { label: 'Mono', body: 'ui-monospace, monospace', heading: 'ui-monospace, monospace' },
  'jetbrains-mono': {
    label: 'JetBrains Mono',
    body: "'JetBrains Mono', ui-monospace, monospace",
    heading: "'JetBrains Mono', ui-monospace, monospace",
  },
  geo: { label: 'Geo', body: "'Geo', sans-serif", heading: "'Geo', sans-serif" },
  'fff-forward': {
    label: 'FFF Forward',
    body: "'FFF Forward', ui-monospace, monospace",
    heading: "'FFF Forward', ui-monospace, monospace",
  },
};

export function profileFontStyle(font: ProfileFont = 'original') {
  const choice = profileFonts[font] ?? profileFonts.original;
  return { '--space-font-body': choice.body, '--space-font-heading': choice.heading };
}
