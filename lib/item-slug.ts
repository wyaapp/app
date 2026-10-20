export function suggestItemSlug(title: string, existingSlugs: string[], fallback: string): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 35)
      .replace(/-$/, '') || fallback;
  let slug = base;
  for (let count = 2; existingSlugs.includes(slug); count++) slug = `${base}-${count}`;
  return slug;
}
