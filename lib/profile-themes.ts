export const themeIds = ['lilac', 'lime', 'ink', 'sky', 'rose', 'peach', 'amber', 'mint', 'coral', 'periwinkle', 'sand', 'navy'] as const;
export type ProfileTheme = typeof themeIds[number];

// Shared by public profiles, the dashboard picker, and API/MCP validation.
export const profileThemes: Record<ProfileTheme, {label: string; color: string; text: string}> = {
  lilac: {label: 'Lilac', color: '#c3a6ff', text: '#1c1b1a'},
  lime: {label: 'Lime', color: '#c9f779', text: '#1c1b1a'},
  ink: {label: 'Ink', color: '#303035', text: '#ffffff'},
  sky: {label: 'Sky', color: '#a9d9ff', text: '#1c1b1a'},
  rose: {label: 'Rose', color: '#ffb8d4', text: '#1c1b1a'},
  peach: {label: 'Peach', color: '#ffd0a8', text: '#1c1b1a'},
  amber: {label: 'Amber', color: '#ffe45e', text: '#1c1b1a'},
  mint: {label: 'Mint', color: '#9ee8c5', text: '#1c1b1a'},
  coral: {label: 'Coral', color: '#ff9985', text: '#1c1b1a'},
  periwinkle: {label: 'Periwinkle', color: '#b8c0ff', text: '#1c1b1a'},
  sand: {label: 'Sand', color: '#e8d9bb', text: '#1c1b1a'},
  navy: {label: 'Navy', color: '#243b64', text: '#ffffff'},
};

export function profileThemeStyle(theme: ProfileTheme) {
  const palette = profileThemes[theme] ?? profileThemes.lilac;
  return {'--accent': palette.color, '--profile-ink': palette.text};
}
