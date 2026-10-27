export type FileFormat = 'markdown' | 'text' | 'widget';

/** Extensions describe how an existing text file is presented, not another storage model. */
export function getFileFormat(name: string): FileFormat | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  if (extension === 'md') return 'markdown';
  if (extension === 'txt') return 'text';
  if (extension === 'widget') return 'widget';
  return null;
}

export function isRichTextFile(name: string): boolean {
  const format = getFileFormat(name);
  return format === 'markdown' || format === 'widget';
}
