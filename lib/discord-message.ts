// Discord counts UTF-16 string length. Escape Markdown, then bound the output,
// leaving complete surrogate pairs and no dangling escape at a truncation point.
export function discordText(value: string, maximum: number) {
  const escaped = value
    .slice(0, maximum)
    .replace(/[\uD800-\uDBFF]$/, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[\\`*_{}[\]()#+.!>|~<\-]/g, '\\$&');
  if (escaped.length <= maximum) return escaped;
  return (
    escaped
      .slice(0, maximum - 1)
      .replace(/[\uD800-\uDBFF]$/, '')
      .replace(/\\$/, '') + '…'
  );
}

/** Keep credentials, paths, queries and fragments out of diagnostic metadata. */
export function configuredOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
