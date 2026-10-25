import type { Nodes } from 'mdast';
import { AppError } from './app-error.ts';

export type P5Embed = { url: string; title: string };

export const P5_MAX_TITLE_LENGTH = 100;
const editorHosts = new Set(['editor.p5js.org', 'preview.p5js.org']);
const editorPath =
  /^\/([a-zA-Z0-9._-]{1,64})\/(?:sketches|full|embed|present)\/([a-zA-Z0-9_-]{1,100})(?:\/sketch\.js)?\/?$/;

/** Accept only official hosted sketches; arbitrary URLs never become frame sources. */
export function parseP5Url(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (editorHosts.has(url.hostname)) {
    const match = editorPath.exec(url.pathname);
    if (!match || match[1] === '.' || match[1] === '..') return null;
    return `https://editor.p5js.org/${match[1]}/sketches/${match[2]}`;
  }
  return null;
}

export function p5EditorProject(input: string): { username: string; id: string } | null {
  const canonical = parseP5Url(input);
  if (!canonical) return null;
  const url = new URL(canonical);
  if (url.hostname !== 'editor.p5js.org') return null;
  const match = editorPath.exec(url.pathname);
  return match ? { username: match[1], id: match[2] } : null;
}

/** Ignore legacy source snapshots when opening an existing document or clipboard block. */
export function normalizeP5Embed(value: unknown): P5Embed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const embed = value as Record<string, unknown>;
  if (
    typeof embed.url !== 'string' ||
    (embed.title !== undefined &&
      (typeof embed.title !== 'string' ||
        embed.title.length > P5_MAX_TITLE_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(embed.title)))
  )
    return null;
  const url = parseP5Url(embed.url);
  return url ? { url, title: (embed.title as string | undefined)?.trim() || 'p5.js sketch' } : null;
}

export function p5EmbedUrl(input: string): string {
  const project = p5EditorProject(input);
  if (!project) throw new AppError('Use a public p5.js editor link.');
  return `https://editor.p5js.org/${project.username}/full/${project.id}`;
}

/** Read compact links and the previous source-containing fence format. */
export function parseP5Node(node: Nodes): P5Embed | null {
  if (node.type === 'leafDirective' && node.name === 'p5') {
    if (
      node.children.length ||
      Object.keys(node.attributes ?? {}).some((key) => key !== 'url' && key !== 'title')
    )
      return null;
    return normalizeP5Embed(node.attributes);
  }
  if (node.type !== 'code' || node.lang !== 'p5' || !node.meta || node.meta.length > 4096)
    return null;
  try {
    const meta: unknown = JSON.parse(node.meta);
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    if (Object.keys(meta).some((key) => key !== 'url' && key !== 'title')) return null;
    return normalizeP5Embed(meta);
  } catch {
    return null;
  }
}

export function p5MarkdownNode(embed: P5Embed): Extract<Nodes, { type: 'leafDirective' }> {
  const value = normalizeP5Embed(embed);
  if (!value) throw new AppError('Use a public p5.js editor link.');
  return {
    type: 'leafDirective',
    name: 'p5',
    attributes: { url: value.url, title: value.title },
    children: [],
  };
}

/** Parsing in a detached template does not load or execute the pasted frame. */
export function parseP5Input(input: string): string | null {
  const text = input.trim();
  const url = parseP5Url(text);
  if (url) return url;
  if (text.length > 8192 || !/^<iframe[\s>]/i.test(text) || typeof document === 'undefined')
    return null;
  const template = document.createElement('template');
  template.innerHTML = text;
  const nodes = [...template.content.childNodes].filter(
    (node) => node.nodeType !== Node.TEXT_NODE || !!node.textContent?.trim(),
  );
  if (nodes.length !== 1 || !(nodes[0] instanceof HTMLIFrameElement)) return null;
  const frame = nodes[0];
  if (frame.hasAttribute('srcdoc') || frame.textContent?.trim()) return null;
  return parseP5Url(frame.getAttribute('src') ?? '');
}
