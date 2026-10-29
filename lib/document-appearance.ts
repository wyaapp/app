import { z } from 'zod';
import { fontIds, profileFonts } from './profile-fonts.ts';
import { themeIds, profileThemes } from './profile-themes.ts';
import { syntaxThemeStyle } from './syntax-theme.ts';

export const documentThemeIds = ['light', 'dim', 'black'] as const;
export type DocumentTheme = (typeof documentThemeIds)[number];
export const documentThemes = {
  light: {
    label: 'Light',
    background: '#fffdf5',
    text: '#1c1b1a',
    muted: '#605c56',
    line: '#1c1b1a',
    scheme: 'light',
  },
  dim: {
    label: 'Dark dimmed',
    background: '#242529',
    text: '#f0eee8',
    muted: '#b5b3ad',
    line: '#696a70',
    scheme: 'dark',
  },
  black: {
    label: 'Full black',
    background: '#000000',
    text: '#f0eee8',
    muted: '#aaa9a4',
    line: '#606166',
    scheme: 'dark',
  },
} as const;

// Read older documents without exposing arbitrary surface/text colors in the editor.
const legacyBackgroundIds = ['paper', 'white', 'sand', 'rose', 'mint', 'sky', 'lilac'] as const;

/** Accept only opaque hex colors, with one canonical form for snapshots and drafts. */
export function normalizeDocumentColor(value: string): string | null {
  const color = value.trim().toLowerCase();
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/.test(color)) return null;
  return color.length === 4
    ? `#${[...color.slice(1)].map((channel) => channel.repeat(2)).join('')}`
    : color;
}

const documentColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[\da-f]{3}|[\da-f]{6})$/i)
  .transform((value) => normalizeDocumentColor(value)!);

// Light is the default; accent and fonts inherit the space when omitted.
// Legacy background/text fields are accepted at the boundary and converted on read/write.
export const documentAppearanceSchema = z
  .object({
    theme: z.enum(documentThemeIds).optional(),
    accent: z.union([z.enum(themeIds), documentColorSchema]).optional(),
    headingFont: z.enum(fontIds).optional(),
    bodyFont: z.enum(fontIds).optional(),
    background: z.union([z.enum(legacyBackgroundIds), documentColorSchema]).optional(),
    textColor: documentColorSchema.optional(),
  })
  .strict()
  .transform(({ theme, background, accent, headingFont, bodyFont }) => {
    const resolvedTheme = theme ?? legacyTheme(background);
    return {
      ...(resolvedTheme !== 'light' ? { theme: resolvedTheme } : {}),
      ...(accent ? { accent } : {}),
      ...(headingFont ? { headingFont } : {}),
      ...(bodyFont ? { bodyFont } : {}),
    };
  });
export type DocumentAppearance = z.infer<typeof documentAppearanceSchema>;

function legacyTheme(background?: string): DocumentTheme {
  const hex = background && normalizeDocumentColor(background);
  if (!hex) return 'light';
  const luminance = colorLuminance(hex);
  return luminance < 0.005 ? 'black' : luminance < 0.25 ? 'dim' : 'light';
}

/** Canonical order keeps old/new snapshots and drafts comparable. */
export function normalizeDocumentAppearance(value: unknown): DocumentAppearance {
  const result = documentAppearanceSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function sameDocumentAppearance(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeDocumentAppearance(left)) ===
    JSON.stringify(normalizeDocumentAppearance(right))
  );
}

function colorLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** Pick the design system's ink or paper by the actual contrast with this color. */
export function documentColorInk(hex: string): string {
  const color = normalizeDocumentColor(hex);
  if (!color) return '#1c1b1a';
  const luminance = colorLuminance(color);
  const contrast = (ink: string) => {
    const inkLuminance = colorLuminance(ink);
    return (Math.max(luminance, inkLuminance) + 0.05) / (Math.min(luminance, inkLuminance) + 0.05);
  };
  const ink = contrast('#1c1b1a') >= contrast('#fffdf5') ? '#1c1b1a' : '#fffdf5';
  if (contrast(ink) >= 4.5) return ink;
  return contrast('#000000') >= contrast('#ffffff') ? '#000000' : '#ffffff';
}

export function resolveDocumentAccent(
  accent?: DocumentAppearance['accent'],
): { color: string; text: string } | undefined {
  if (!accent) return undefined;
  if (Object.hasOwn(profileThemes, accent))
    return profileThemes[accent as (typeof themeIds)[number]];
  const color = normalizeDocumentColor(accent);
  return color ? { color, text: documentColorInk(color) } : undefined;
}

export function documentAppearanceStyle(appearance?: DocumentAppearance) {
  const {
    theme = 'light',
    accent,
    headingFont,
    bodyFont,
  } = normalizeDocumentAppearance(appearance);
  const palette = documentThemes[theme];
  const accentColor = resolveDocumentAccent(accent);
  return {
    colorScheme: palette.scheme,
    color: palette.text,
    ...syntaxThemeStyle(theme),
    '--paper': palette.background,
    '--ink': palette.text,
    '--muted': palette.muted,
    '--line': palette.line,
    // Rebind composite tokens here: root-level variables have already resolved there.
    '--border': '2px solid var(--line)',
    '--shadow': '4px 4px 0 var(--line)',
    '--document-background': palette.background,
    '--document-text': palette.text,
    '--document-muted': palette.muted,
    '--document-accent': accentColor?.color ?? 'var(--space-accent, var(--accent, #c3a6ff))',
    '--document-accent-ink':
      accentColor?.text ?? 'var(--space-accent-ink, var(--profile-ink, #1c1b1a))',
    '--document-control': 'color-mix(in srgb, var(--document-accent) 16%, var(--paper))',
    '--yellow': 'var(--document-control)',
    '--lime': 'var(--document-control)',
    '--lilac': 'var(--document-control)',
    ...(accentColor ? { '--accent': accentColor.color, '--profile-ink': accentColor.text } : {}),
    ...(headingFont ? { '--document-font-heading': profileFonts[headingFont].heading } : {}),
    ...(bodyFont ? { '--document-font-body': profileFonts[bodyFont].body } : {}),
  };
}
