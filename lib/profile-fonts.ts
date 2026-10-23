export const fontIds = ['original', 'system', 'serif', 'mono'] as const;
export type ProfileFont = (typeof fontIds)[number];

// Curated stacks only. Extra choices use installed fonts, with no new font requests.
export const profileFonts: Record<ProfileFont, { label: string; body: string; heading: string }> = {
  original: {
    label: 'Original',
    body: "'DM Sans', sans-serif",
    heading: "'Space Grotesk', sans-serif",
  },
  system: { label: 'Clean sans', body: 'system-ui, sans-serif', heading: 'system-ui, sans-serif' },
  serif: { label: 'Editorial', body: 'Georgia, serif', heading: 'Georgia, serif' },
  mono: { label: 'Mono', body: 'ui-monospace, monospace', heading: 'ui-monospace, monospace' },
};

export function profileFontStyle(font: ProfileFont = 'original') {
  const choice = profileFonts[font] ?? profileFonts.original;
  return { '--space-font-body': choice.body, '--space-font-heading': choice.heading };
}
