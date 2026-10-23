// Categories describe what an entry does; authenticated routes supply private apps and guides.
export const desktopCategories = {
  content: { label: 'Content', description: 'The page visitors explore.' },
  apps: { label: 'Apps', description: 'Create, edit, and explore.' },
  settings: { label: 'Settings', description: 'Appearance and preferences.' },
  guides: { label: 'Guides', description: 'Help getting things set up.' },
} as const;
export type DesktopCategory = keyof typeof desktopCategories;
export const desktopCategoryIds = Object.keys(desktopCategories) as DesktopCategory[];
