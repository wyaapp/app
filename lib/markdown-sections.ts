import type { Nodes } from 'mdast';
import {
  pageDirectiveSection,
  parsePageTree,
  stringifyPageTree,
  type PageSourceOptions,
} from './page-documents.ts';

function removeContainerIndent(
  source: string,
  indent: number,
  firstLine: number,
  literalLines: Set<number>,
): string {
  return source
    .split('\n')
    .map((line, index) =>
      line.replace(/^[ \t]+/, (prefix) => {
        let offset = 0;
        let columns = 0;
        while (offset < prefix.length && columns < indent) {
          columns += prefix[offset++] === '\t' ? 4 - (columns % 4) : 1;
        }
        let remaining = Math.max(0, columns - indent);
        // Preserve tab stops in structural indentation. Once four columns have
        // been reached, any remaining tabs are literal indented-code content.
        if (!literalLines.has(firstLine + index)) {
          while (offset < prefix.length && remaining < 4) {
            const width = prefix[offset++] === '\t' ? 4 - (columns % 4) : 1;
            columns += width;
            remaining += width;
          }
        }
        return ' '.repeat(remaining) + prefix.slice(offset);
      }),
    )
    .join('\n');
}

/** Retire legacy section wrappers without rewriting the Markdown inside them. */
export function flattenMarkdownSections(source: string, options: PageSourceOptions = {}): string {
  // Validate before touching source. Code examples and unknown containers stay opaque.
  const tree = parsePageTree(source, options);
  const edits: { from: number; to: number; value: string }[] = [];
  for (const node of tree.children) {
    const section = pageDirectiveSection(node);
    if (!section) continue;
    const from = node.position!.start.offset!;
    const to = node.position!.end.offset!;
    const original = source.slice(from, to);
    const openingEnd = original.indexOf('\n');
    const closingStart = original.lastIndexOf('\n') + 1;
    const crlf = original[openingEnd - 1] === '\r';
    const newline = crlf ? '\r\n' : '\n';
    const heading = section.title
      ? stringifyPageTree({
          type: 'root',
          children: [
            { type: 'heading', depth: 3, children: [{ type: 'text', value: section.title }] },
          ],
        }).trimEnd()
      : '';
    // Keep the original line ending as a block separator even for an untitled section.
    edits.push({
      from,
      to: from + openingEnd - (crlf ? 1 : 0),
      value: heading ? heading + newline : '',
    });
    const indent = node.position!.start.column - 1;
    if (indent) {
      // Directive containers consume their opening indentation from each child
      // line. Preserve that relative indentation when lifting children to root.
      const bodyStart = from + openingEnd + 1;
      const bodyEnd = from + closingStart;
      const literalLines = new Set<number>();
      function findFencedCode(child: Nodes) {
        if (
          child.type === 'code' &&
          /^(`{3,}|~{3,})/.test(source.slice(child.position!.start.offset!))
        ) {
          for (let line = child.position!.start.line + 1; line < child.position!.end.line; line++)
            literalLines.add(line);
        }
        if ('children' in child) child.children.forEach(findFencedCode);
      }
      findFencedCode(node);
      edits.push({
        from: bodyStart,
        to: bodyEnd,
        value: removeContainerIndent(
          source.slice(bodyStart, bodyEnd),
          indent,
          node.position!.start.line + 1,
          literalLines,
        ),
      });
    }
    edits.push({ from: from + closingStart, to, value: '' });
  }
  for (const edit of edits.reverse())
    source = source.slice(0, edit.from) + edit.value + source.slice(edit.to);
  return source;
}
