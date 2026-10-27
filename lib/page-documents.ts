import type { Nodes, Root, RootContent } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkDirective from 'remark-directive';
import { remarkStrikethrough } from './remark-strikethrough.ts';
import { AppError } from './app-error.ts';
import { getLayoutGroups, type LinkLayout } from './link-layout.ts';
import { getProfileLayout, type ProfileTab } from './profile-tabs.ts';
import type { LinkItem, ProfileData } from './profile-types.ts';
import { parseP5Node } from './p5.ts';
import { parseGifDirective } from './gif.ts';
import { parseImageDirective } from './image.ts';
import { parseBadgeDirective } from './badge.ts';
import { parseFontDirective } from './remark-fonts.ts';

export const MAX_PAGE_DOCUMENT_BYTES = 128 * 1024;
export type PageSourceOptions = { preserveUnknown?: boolean };

type LeafNode = Extract<Nodes, { type: 'leafDirective' }>;
type ItemNode = LeafNode | Extract<Nodes, { type: 'code' }>;
type SectionNode = Extract<Nodes, { type: 'containerDirective' }>;
type PageSection = LinkLayout['sections'][number];
type StructuralNode = ItemNode | SectionNode;
type SourceSection = { source: string; node: SectionNode };
type SourceItem = { source: string; node: ItemNode; item: LinkItem };
export type ParsedPageSource = {
  tree: Root;
  items: { item: LinkItem; sectionId?: string }[];
  sections: PageSection[];
  layout: LinkLayout;
};

const processor = unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(remarkStrikethrough)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    rule: '-',
    ruleRepetition: 3,
    handlers: {
      text(node, parent, state, info) {
        if (
          parent?.type === 'leafDirective' ||
          (parent?.type === 'paragraph' && parent.data?.directiveLabel)
        )
          return node.value.replace(
            /[\\&[\]`*_~:<>!\r\n]/g,
            (character: string) => `&#${character.charCodeAt(0)};`,
          );
        return state.safe(node.value, info);
      },
    },
  });

const linkAttributes = new Set(['id', 'slug', 'url', 'platform', 'icon', 'visible', 'aliases']);
const richKinds = new Set(['project', 'interest', 'collection', 'discord']);

function fail(message: string): never {
  throw new AppError(message);
}

function attributes(node: LeafNode | SectionNode, allowed: Set<string>) {
  const values = node.attributes ?? {};
  for (const key of Object.keys(values))
    if (!allowed.has(key)) fail(`Unsupported ${node.name} attribute: ${key}.`);
  return values;
}

function label(children: readonly Nodes[]): string {
  if (children.some((child) => child.type !== 'text'))
    fail('Use plain text for card and section titles.');
  return children.map((child) => (child.type === 'text' ? child.value : '')).join('');
}

/** Extract the card payload. URL and field policy is checked by the publication compiler. */
export function pageDirectiveItem(node: Nodes): LinkItem | null {
  if (!isItemNode(node)) return null;
  if (node.type === 'code' || node.name === 'item') {
    let data: string;
    if (node.type === 'code') {
      if (node.meta) fail('A Wya block has invalid syntax. Check its brackets and attributes.');
      data = node.value;
    } else {
      const values = attributes(node, new Set(['data']));
      if (node.children.length || !values.data) fail('A rich item needs a data attribute.');
      data = values.data;
    }
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      fail('The rich item data is not valid JSON.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail('The rich item data must be an object.');
    const item = value as LinkItem;
    if (!item.kind || !richKinds.has(item.kind)) fail('Unsupported rich item type.');
    if ('sectionId' in item) fail('Place items inside a section instead of setting sectionId.');
    return item;
  }
  const values = attributes(node, linkAttributes);
  if (!values.slug || !values.url) fail('A link needs a slug and a URL.');
  if (values.visible !== undefined && !['true', 'false'].includes(values.visible ?? ''))
    fail('Link visibility must be true or false.');
  return {
    ...(values.id ? { id: values.id } : {}),
    slug: values.slug,
    label: label(node.children),
    url: values.url,
    platform: (values.platform || 'website') as LinkItem['platform'],
    ...(values.icon ? { icon: values.icon as LinkItem['icon'] } : {}),
    ...('aliases' in values
      ? { aliases: (values.aliases ?? '').split(/\s+/).filter(Boolean) }
      : {}),
    visible: values.visible !== 'false',
  };
}

export function pageDirectiveSection(node: Nodes): { id: string; title: string } | null {
  if (node.type !== 'containerDirective' || node.name !== 'section') return null;
  const values = attributes(node, new Set(['id']));
  const title = node.children.find(
    (child) => child.type === 'paragraph' && child.data?.directiveLabel,
  );
  if (!values.id) fail('A section needs an ID.');
  // A title can be temporarily empty while editing. Publication validates its required length.
  return { id: values.id, title: title?.type === 'paragraph' ? label(title.children) : '' };
}

function children(node: Nodes): readonly Nodes[] {
  return 'children' in node ? node.children : [];
}

/** Directive syntax must not consume ordinary Markdown such as "Ratio 1:2". */
export function restoreMarkdownText(tree: Root, source: string): void {
  const visit = (node: Nodes) => {
    if (!('children' in node)) return;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      if (
        child.type === 'textDirective' &&
        !['link', 'item', 'section', 'badge'].includes(child.name) &&
        !parseFontDirective(child)
      )
        node.children[index] = {
          type: 'text',
          value: raw(source, child),
          position: child.position,
        };
      // Titles are plain text. Keep tildes from existing titles literal when enabling strike.
      else if (
        child.type === 'delete' &&
        (node.type === 'leafDirective' || (node.type === 'paragraph' && node.data?.directiveLabel))
      )
        node.children[index] = {
          type: 'text',
          value: raw(source, child),
          position: child.position,
        };
      else visit(child);
    }
  };
  visit(tree);
}

/** Parse the small Wya vocabulary without evaluating HTML, code, or arbitrary components. */
export function parsePageSource(source: string, options: PageSourceOptions = {}): ParsedPageSource {
  if (source.includes('\0')) fail('Page documents cannot contain null characters.');
  if (new TextEncoder().encode(source).byteLength > MAX_PAGE_DOCUMENT_BYTES)
    fail('A page document must be 128 KB or smaller.');
  const tree = processor.parse(source);
  restoreMarkdownText(tree, source);
  const items: ParsedPageSource['items'] = [];
  const sections: PageSection[] = [];
  const ungrouped: string[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const sectionIds = new Set<string>();
  let ungroupedPosition: number | undefined;

  function visit(node: Nodes, parent: Nodes, section?: PageSection) {
    if (node.type === 'code' && node.lang === 'p5') {
      // Recognized legacy links become live embeds. Other old fences stay inert code.
      return;
    }
    if (node.type === 'leafDirective' && node.name === 'p5') {
      if (!parseP5Node(node)) fail('Use a public p5.js editor link.');
      return;
    }
    if (node.type === 'textDirective' && node.name === 'badge') {
      if (!parseBadgeDirective(node)) fail('Use a valid badge image and website link.');
      return;
    }
    // File documents can contain third-party directives. Keep the whole construct
    // opaque, while recognized Wya syntax still receives the normal validation.
    if (
      options.preserveUnknown &&
      (node.type === 'leafDirective' || node.type === 'containerDirective') &&
      !['link', 'item', 'section', 'gif', 'image'].includes(node.name)
    )
      return;
    if (node.type === 'leafDirective' && node.name === 'gif') {
      if (!parseGifDirective(node)) fail('Use a valid GIPHY or Tenor GIF.');
      return;
    }
    if (node.type === 'leafDirective' && node.name === 'image') {
      if (!parseImageDirective(node)) fail('Use a valid HTTPS image URL.');
      return;
    }
    if (node.type === 'containerDirective') {
      if (node.name !== 'section' || parent.type !== 'root')
        fail('Sections must be at the top level of a page.');
      const value = pageDirectiveSection(node)!;
      if (sectionIds.has(value.id)) fail('Section IDs must be unique within a page.');
      sectionIds.add(value.id);
      const lastLine = source.slice(start(node), end(node)).split(/\r?\n/).at(-1) ?? '';
      if (!/^\s*:{3,}\s*$/.test(lastLine)) fail('Close each section with ::: on its own line.');
      const next = { ...value, slugs: [] as string[] };
      sections.push(next);
      for (const child of node.children) visit(child, node, next);
      return;
    }
    if (node.type === 'leafDirective' || isItemNode(node)) {
      if (!isItemNode(node) || (parent.type !== 'root' && parent.type !== 'containerDirective'))
        fail('Place link and item blocks at the top level or directly inside a section.');
      if (node.type === 'code') {
        const lines = raw(source, node).split(/\r?\n/);
        const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*wya-item[ \t]*$/.exec(lines[0])?.[1];
        if (
          !fence ||
          lines.length < 3 ||
          !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(lines.at(-1)!)
        )
          fail('Close each wya-item block with its matching code fence.');
      }
      const item = pageDirectiveItem(node)!;
      if (typeof item.slug !== 'string' || !item.slug) fail('Every card needs a slug.');
      if (item.id !== undefined && (typeof item.id !== 'string' || !item.id))
        fail('A card ID must be a nonempty string.');
      if (slugs.has(item.slug)) fail('Card slugs must be unique within a page.');
      if (item.id && ids.has(item.id)) fail('Card IDs must be unique within a page.');
      slugs.add(item.slug);
      if (item.id) ids.add(item.id);
      if (section) section.slugs.push(item.slug);
      else {
        ungroupedPosition ??= sections.length;
        ungrouped.push(item.slug);
      }
      items.push({ item, ...(section ? { sectionId: section.id } : {}) });
      return;
    }
    if (node.type === 'textDirective' && !parseFontDirective(node))
      fail('Only Wya link, item, and section blocks are supported.');
    if (
      node.type === 'paragraph' &&
      /^ {0,3}:{2,}(?:link|item|section|gif|image)\b/m.test(raw(source, node))
    )
      fail('A Wya block has invalid syntax. Check its brackets and attributes.');
    for (const child of children(node)) visit(child, node, section);
  }
  for (const node of tree.children) visit(node, tree);
  return {
    tree,
    items,
    sections,
    layout: {
      ungrouped,
      sections,
      ...(ungroupedPosition ? { ungroupedPosition } : {}),
    },
  };
}

export function parsePageTree(source: string, options: PageSourceOptions = {}): Root {
  return parsePageSource(source, options).tree;
}

export function stringifyPageTree(tree: Root): string {
  return processor.stringify(tree);
}

function richItemNode(item: LinkItem): Extract<ItemNode, { type: 'code' }> {
  return { type: 'code', lang: 'wya-item', value: JSON.stringify(item, null, 2) };
}

function itemNode(item: LinkItem, preserveIdOmission = false): ItemNode {
  const payload = { ...item };
  delete payload.sectionId;
  const id = item.id ?? (preserveIdOmission ? undefined : `legacy:${item.slug}`);
  if (item.kind) return richItemNode({ ...payload, ...(id ? { id } : {}) });
  return {
    type: 'leafDirective',
    name: 'link',
    attributes: {
      ...(id ? { id } : {}),
      slug: item.slug,
      url: item.url,
      platform: item.platform,
      ...(item.icon ? { icon: item.icon } : {}),
      ...(item.aliases && (item.aliases.length || preserveIdOmission)
        ? { aliases: item.aliases.join(' ') }
        : {}),
      ...(!item.visible ? { visible: 'false' } : {}),
    },
    children: [{ type: 'text', value: item.label }],
  };
}

function sectionNode(section: { id: string; title: string }, items: LinkItem[]): SectionNode {
  return {
    type: 'containerDirective',
    name: 'section',
    attributes: { id: section.id },
    children: [
      {
        type: 'paragraph',
        data: { directiveLabel: true },
        children: [{ type: 'text', value: section.title }],
      },
      ...items.map((item) => itemNode(item)),
    ],
  };
}

export function serializePageItem(
  item: LinkItem,
  options: { preserveIdOmission?: boolean } = {},
): string {
  return stringifyPageTree({
    type: 'root',
    children: [itemNode(item, options.preserveIdOmission)],
  }).trimEnd();
}

export function serializePageSection(
  section: { id: string; title: string },
  items: LinkItem[] = [],
): string {
  return stringifyPageTree({ type: 'root', children: [sectionNode(section, items)] }).trimEnd();
}

/** Upgrade escaped attribute payloads without rewriting prose or changing card metadata. */
export function normalizePageSource(source: string): string {
  if (!source.includes('::item')) return source;
  const { tree } = parsePageSource(source);
  const patches: Replacement[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'leafDirective' && node.name === 'item') {
      const item = pageDirectiveItem(node)!;
      patches.push({
        start: start(node),
        end: end(node),
        value: stringifyPageTree({ type: 'root', children: [richItemNode(item)] }).trimEnd(),
      });
    } else if (node.type === 'containerDirective') node.children.forEach(visit);
  };
  tree.children.forEach(visit);
  return replace(source, patches);
}

/** Legacy tabs are projected into documents lazily; publishing is still an explicit operation. */
export function getPageSource(data: ProfileData, tab: ProfileTab | string): string {
  const resolved =
    typeof tab === 'string' ? getProfileLayout(data).tabs.find((t) => t.id === tab) : tab;
  if (!resolved) fail('Page not found.');
  if (typeof data.documents?.[resolved.id] === 'string')
    return normalizePageSource(data.documents[resolved.id]);
  const nodes: RootContent[] = [];
  const links = new Map(data.links.map((item) => [item.slug, item]));
  for (const group of getLayoutGroups(resolved)) {
    const items = group.slugs.flatMap((slug) => (links.has(slug) ? [links.get(slug)!] : []));
    if (group.id) nodes.push(sectionNode(group, items));
    else nodes.push(...items.map((item) => itemNode(item)));
  }
  return stringifyPageTree({ type: 'root', children: nodes });
}

function start(node: Nodes): number {
  return node.position!.start.offset!;
}

function end(node: Nodes): number {
  return node.position!.end.offset!;
}

function raw(source: string, node: Nodes): string {
  return source.slice(start(node), end(node));
}

function isItemNode(node: Nodes): node is ItemNode {
  return (
    (node.type === 'leafDirective' && ['link', 'item'].includes(node.name)) ||
    (node.type === 'code' && node.lang === 'wya-item')
  );
}

function isStructural(node: Nodes): node is StructuralNode {
  return isItemNode(node) || node.type === 'containerDirective';
}

function identity(item: LinkItem): string {
  return item.id ?? `legacy:${item.slug}`;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
}

function comparableItem(item: LinkItem) {
  const value = { ...item };
  delete value.sectionId;
  return { ...value, id: identity(item), ...(item.aliases?.length ? {} : { aliases: undefined }) };
}

type Replacement = { start: number; end: number; value: string };
function replace(source: string, replacements: Replacement[]): string {
  let result = source;
  for (const patch of [...replacements].sort((a, b) => b.start - a.start))
    result = result.slice(0, patch.start) + patch.value + result.slice(patch.end);
  return result;
}

/** Replace only recognized card payloads, preserving all surrounding Markdown exactly. */
export function projectPageSource(
  source: string,
  links: LinkItem[],
  options: PageSourceOptions = {},
): string {
  const parsed = parsePageSource(source, options);
  const allowed = new Map(links.map((item) => [identity(item), item]));
  const patches: Replacement[] = [];
  const visit = (node: Nodes) => {
    if (isItemNode(node)) {
      const item = pageDirectiveItem(node)!;
      const safe = allowed.get(identity(item));
      if (!safe) patches.push({ start: start(node), end: end(node), value: '' });
      else if (stable(comparableItem(item)) !== stable(comparableItem(safe)))
        patches.push({ start: start(node), end: end(node), value: serializePageItem(safe) });
    } else if (node.type === 'containerDirective' && node.name === 'section')
      node.children.forEach(visit);
  };
  parsed.tree.children.forEach(visit);
  return replace(source, patches);
}

function append(source: string, value: string): string {
  if (!value) return source;
  return `${source}${source && !source.endsWith('\n\n') ? (source.endsWith('\n') ? '\n' : '\n\n') : ''}${value}\n`;
}

/** Keep ordinary Markdown byte-for-byte; use existing rich-block positions as visual-edit slots. */
function fillSlots(
  source: string,
  slots: StructuralNode[],
  values: string[],
  offset = 0,
  preserved = new Map<StructuralNode, string>(),
): string {
  if (!slots.length) return append(source, values.join('\n\n'));
  const patches = slots.map((slot, index) => {
    const remaining =
      index === slots.length - 1 ? values.slice(index).join('\n\n') : (values[index] ?? '');
    const note = preserved.get(slot);
    return {
      start: start(slot) - offset,
      end: end(slot) - offset,
      value: [note, remaining].filter(Boolean).join('\n\n'),
    };
  });
  return replace(source, patches);
}

function sectionBody(source: string, node: SectionNode) {
  const from = source.indexOf('\n', start(node)) + 1;
  const to = source.lastIndexOf('\n', end(node) - 1) + 1;
  return { from, to, value: source.slice(from, to) };
}

function sourceIndexes(documents: Map<string, { source: string; parsed: ParsedPageSource }>) {
  const items = new Map<string, SourceItem>();
  const slugs = new Map<string, SourceItem>();
  const sections = new Map<string, SourceSection>();
  for (const { source, parsed } of documents.values()) {
    const collect = (node: Nodes) => {
      if (isItemNode(node)) {
        const item = pageDirectiveItem(node)!;
        const record = { source, node, item };
        items.set(identity(item), record);
        slugs.set(item.slug, record);
      } else if (node.type === 'containerDirective') {
        sections.set(pageDirectiveSection(node)!.id, { source, node });
        node.children.forEach(collect);
      }
    };
    parsed.tree.children.forEach(collect);
  }
  return { items, slugs, sections };
}

function placement(layout: LinkLayout, items: LinkItem[]): string {
  const bySlug = new Map(items.map((item) => [item.slug, identity(item)]));
  return stable(
    getLayoutGroups(layout).map((group) => ({
      id: group.id,
      items: group.slugs.map((slug) => bySlug.get(slug) ?? slug),
    })),
  );
}

/**
 * Visual edits update the same document used by source editing. Only Wya block spans change;
 * prose, code fences, headings, dividers, and reference definitions are never reserialized.
 */
export function syncPageDocuments<T extends ProfileData>(
  before: ProfileData,
  after: T,
  removedTabTransfer?: { fromTabId: string; toTabId: string },
): T {
  const oldTabs = getProfileLayout(before).tabs;
  const tabs = getProfileLayout(after).tabs;
  const documents = new Map(
    oldTabs.map((tab) => {
      const source = getPageSource(before, tab);
      return [tab.id, { source, parsed: parsePageSource(source) }];
    }),
  );
  const indexes = sourceIndexes(documents);
  const links = new Map(after.links.map((item) => [item.slug, item]));
  const survivingSections = new Set(
    tabs.flatMap((tab) => tab.sections.map((section) => section.id)),
  );

  const renderItem = (item: LinkItem): string => {
    const previous = indexes.items.get(identity(item)) ?? indexes.slugs.get(item.slug);
    return previous &&
      previous.item.id === identity(item) &&
      stable(comparableItem(previous.item)) === stable(comparableItem(item))
      ? raw(previous.source, previous.node)
      : serializePageItem(item);
  };

  const renderSection = (section: PageSection): string => {
    const original = indexes.sections.get(section.id);
    const values = section.slugs.flatMap((slug) =>
      links.has(slug) ? [renderItem(links.get(slug)!)] : [],
    );
    if (!original)
      return serializePageSection(
        section,
        section.slugs.flatMap((slug) => (links.has(slug) ? [links.get(slug)!] : [])),
      );
    const { source, node } = original;
    const body = sectionBody(source, node);
    const oldTitle = pageDirectiveSection(node)!.title;
    const opening =
      oldTitle === section.title
        ? source.slice(start(node), body.from)
        : `${serializePageSection(section).split('\n')[0]}\n`;
    const nextBody = fillSlots(body.value, node.children.filter(isStructural), values, body.from);
    return `${opening}${nextBody}${source.slice(body.to, end(node))}`;
  };

  const result = new Map<string, string>();
  for (const tab of tabs) {
    const previous = documents.get(tab.id);
    if (!previous) {
      const value = getLayoutGroups(tab).flatMap((group) =>
        group.id
          ? [renderSection(group)]
          : group.slugs.flatMap((slug) => (links.has(slug) ? [renderItem(links.get(slug)!)] : [])),
      );
      result.set(tab.id, append('', value.join('\n\n')));
      continue;
    }
    const { source, parsed } = previous;
    const desiredItems = getLayoutGroups(tab).flatMap((group) =>
      group.slugs.flatMap((slug) => (links.has(slug) ? [links.get(slug)!] : [])),
    );
    // If only card fields changed, preserve even unusual interleaving of prose and root cards.
    const samePlacement =
      placement(
        parsed.layout,
        parsed.items.map(({ item }) => item),
      ) === placement(tab, desiredItems);
    if (samePlacement) {
      const patches: Replacement[] = [];
      const desiredIds = new Map(desiredItems.map((item) => [identity(item), item]));
      const visit = (node: Nodes) => {
        if (isItemNode(node)) {
          const item = pageDirectiveItem(node)!;
          const next = desiredIds.get(identity(item)) ?? links.get(item.slug);
          if (next) patches.push({ start: start(node), end: end(node), value: renderItem(next) });
        } else if (node.type === 'containerDirective') {
          const section = tab.sections.find(
            (entry) => entry.id === pageDirectiveSection(node)!.id,
          )!;
          if (section.title !== pageDirectiveSection(node)!.title) {
            const body = sectionBody(source, node);
            patches.push({
              start: start(node),
              end: body.from,
              value: `${serializePageSection(section).split('\n')[0]}\n`,
            });
          }
          node.children.forEach(visit);
        }
      };
      parsed.tree.children.forEach(visit);
      result.set(tab.id, replace(source, patches));
      continue;
    }
    const values = getLayoutGroups(tab).flatMap((group) =>
      group.id
        ? [renderSection(group)]
        : group.slugs.flatMap((slug) => (links.has(slug) ? [renderItem(links.get(slug)!)] : [])),
    );
    const preserved = new Map<StructuralNode, string>();
    for (const node of parsed.tree.children) {
      if (
        node.type !== 'containerDirective' ||
        survivingSections.has(pageDirectiveSection(node)!.id)
      )
        continue;
      const body = sectionBody(source, node);
      // Removing a visual section unwraps its prose instead of discarding text authored in source.
      preserved.set(node, fillSlots(body.value, node.children.filter(isStructural), [], body.from));
    }
    result.set(
      tab.id,
      fillSlots(source, parsed.tree.children.filter(isStructural), values, 0, preserved),
    );
  }
  // Removal transfers source-only notes too. Prefer an explicit, validated destination;
  // older clients without one infer it from cards/sections or fall back to the default.
  for (const [id, { source, parsed }] of documents) {
    if (tabs.some((tab) => tab.id === id)) continue;
    const oldSlugs = new Set(parsed.items.map(({ item }) => item.slug));
    const oldSections = new Set(parsed.sections.map((section) => section.id));
    const target =
      (removedTabTransfer?.fromTabId === id
        ? tabs.find((tab) => tab.id === removedTabTransfer.toTabId)
        : undefined) ??
      tabs.find(
        (tab) =>
          tab.sections.some((section) => oldSections.has(section.id)) ||
          getLayoutGroups(tab).some((group) => group.slugs.some((slug) => oldSlugs.has(slug))),
      ) ??
      tabs.find((tab) => tab.id === after.defaultTabId) ??
      tabs[0];
    if (!target) continue;
    const patches = parsed.tree.children.filter(isStructural).map((node) => {
      let value = '';
      if (
        node.type === 'containerDirective' &&
        !survivingSections.has(pageDirectiveSection(node)!.id)
      ) {
        const body = sectionBody(source, node);
        value = fillSlots(body.value, node.children.filter(isStructural), [], body.from);
      }
      return { start: start(node), end: end(node), value };
    });
    const notes = replace(source, patches);
    if (notes.trim()) result.set(target.id, append(result.get(target.id) ?? '', notes));
  }
  return { ...after, documents: Object.fromEntries(result) };
}

/** Drop hidden cards and hidden-tab sources before public data crosses the server boundary. */
export function publicPageDocuments(profile: ProfileData): Record<string, string> {
  const result = new Map<string, string>();
  const tabs = profile.tabs ?? getProfileLayout(profile).tabs;
  for (const tab of tabs.filter((entry) => !entry.hidden)) {
    const source = getPageSource(profile, tab);
    const allowed = new Set(getLayoutGroups(tab).flatMap((group) => group.slugs));
    result.set(
      tab.id,
      projectPageSource(
        source,
        profile.links.filter((item) => item.visible && allowed.has(item.slug)),
      ),
    );
  }
  return Object.fromEntries(result);
}
