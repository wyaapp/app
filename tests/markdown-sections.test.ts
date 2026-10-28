import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenMarkdownSections } from '../lib/markdown-sections.ts';
import { parsePageSource, serializePageItem, serializePageSection } from '../lib/page-documents.ts';

test('section normalization preserves child source, item identity, media and order', () => {
  const item = {
    id: 'stable-link',
    slug: 'portfolio',
    label: 'Portfolio',
    url: 'https://example.com',
    aliases: ['work', 'projects'],
    platform: 'website' as const,
    visible: false,
  };
  const body = [
    'Prose with  **bold**, `code` and [reference][ref].  ',
    '',
    '- First',
    '- Second',
    '',
    serializePageItem(item),
    '',
    '![An image](https://example.com/image.png "Image title")',
    '',
    '::gif{provider="giphy" id="abc"}',
    '',
    '::p5{url="https://editor.p5js.org/alexcmgit/sketches/UVdcShVG4"}',
    '',
    ':::custom-widget{keep="exact"}',
    '  Unknown content and spacing.',
    ':::',
    '',
    '<!-- Kept verbatim -->',
    '',
  ].join('\n');
  const before = '# Intro\n\nKeep this prefix.\n\n';
  const after = '\n\n[ref]: https://example.com "Reference title"\n';
  // A longer outer fence safely contains the unknown directive.
  const source = before + '::::section[Work]{id="work"}\n' + body + '::::' + after;
  const result = flattenMarkdownSections(source, { preserveUnknown: true });
  assert.equal(result, before + '### Work\n\n' + body + after);
  assert.deepEqual(parsePageSource(result, { preserveUnknown: true }).items, [{ item }]);
  assert.deepEqual(parsePageSource(result, { preserveUnknown: true }).sections, []);
  assert.equal(flattenMarkdownSections(result, { preserveUnknown: true }), result);
});

test('section titles become literal level-three headings without introducing formatting', () => {
  for (const title of [
    '*Bold* & `code` [link] <tag> :badge[x] ~~gone~~ #',
    '  Spaced title  ',
    'One\nTwo',
    'Backslash \\ and colon :value',
  ]) {
    const result = flattenMarkdownSections(serializePageSection({ id: 'title', title }));
    const nodes = parsePageSource(result).tree.children;
    assert.equal(nodes.length, 1);
    const heading = nodes[0];
    assert.equal(heading.type, 'heading');
    if (heading.type !== 'heading') assert.fail('Expected a heading');
    assert.equal(heading.depth, 3);
    assert.deepEqual(
      heading.children.map((child) => ({
        type: child.type,
        value: 'value' in child && child.value,
      })),
      [{ type: 'text', value: title }],
    );
    assert.equal(flattenMarkdownSections(result), result);
  }
});

test('untitled and empty sections retain surrounding block boundaries', () => {
  const source = 'Before\n:::section[]{id="empty-title"}\nContent\n:::\nAfter';
  assert.equal(flattenMarkdownSections(source), 'Before\n\nContent\n\nAfter');
  assert.equal(flattenMarkdownSections(':::section[]{id="empty"}\n:::'), '\n');
  assert.equal(flattenMarkdownSections(':::section[Title]{id="empty"}\n:::'), '### Title\n\n');
});

test('multiple sections preserve non-wrapper bytes and CRLF endings', () => {
  const source =
    'Prefix\r\n\r\n:::section[One]{id="one"}\r\nFirst\r\n:::\r\n\r\n' +
    '  :::section[Two]{id="two"}\r\n  Second\r\n  :::\r\nSuffix\r\n';
  const result = flattenMarkdownSections(source);
  assert.equal(
    result,
    'Prefix\r\n\r\n### One\r\n\r\nFirst\r\n\r\n\r\n' + '  ### Two\r\n\r\nSecond\r\n\r\nSuffix\r\n',
  );
  assert.doesNotMatch(result, /(?<!\r)\n/);
  assert.equal(flattenMarkdownSections(result), result);
});

test('indented wrappers retain child paragraph, list, quote, code and embed semantics', () => {
  const card = serializePageItem({
    id: 'indented-link',
    slug: 'indented-link',
    label: 'Indented link',
    url: 'https://example.com',
    platform: 'website',
    visible: true,
  });
  const body = [
    '  Paragraph with **formatting**.',
    '',
    '  - Outer item',
    '    - Nested item',
    '',
    '> A quote',
    '>',
    '> - A list inside the quote',
    '',
    '    const indentedCode = true;',
    '      keepIndentation();',
    '',
    '```js',
    '  const fencedCode = true;',
    '```',
    '',
    '![Image](https://example.com/image.png)',
    '',
    '::gif{provider="giphy" id="abc"}',
    '',
    card,
    '',
    ':::unknown{opaque="yes"}',
    '  Preserve relative opaque content.',
    ':::',
    '',
  ].join('\n');
  const semantic = (value: unknown) =>
    JSON.parse(JSON.stringify(value, (key, item) => (key === 'position' ? undefined : item)));
  for (const indent of [1, 2, 3]) {
    const prefix = ' '.repeat(indent);
    const indented = body
      .split('\n')
      .map((line) => prefix + line)
      .join('\n');
    const source = `${prefix}::::section[Title]{id="indented"}\n${indented}\n${prefix}::::`;
    const original = parsePageSource(source, { preserveUnknown: true }).tree.children[0];
    assert.equal(original.type, 'containerDirective');
    if (original.type !== 'containerDirective') assert.fail('Expected a legacy section');
    const result = flattenMarkdownSections(source, { preserveUnknown: true });
    const parsed = parsePageSource(result, { preserveUnknown: true });
    assert.equal(result, `${prefix}### Title\n\n${body}\n`);
    assert.deepEqual(semantic(parsed.tree.children.slice(1)), semantic(original.children.slice(1)));
    assert.equal(parsed.items[0].item.id, 'indented-link');
    assert.equal(flattenMarkdownSections(result, { preserveUnknown: true }), result);
  }
});

test('container deindent handles short prefixes without removing child content', () => {
  for (const indent of [1, 2, 3]) {
    for (const childIndent of [0, 1, 2, 3, 4]) {
      const prefix = ' '.repeat(indent);
      const childPrefix = ' '.repeat(childIndent);
      const source = `${prefix}:::section[Title]{id="short"}\n${childPrefix}Text\n${prefix}:::`;
      const result = flattenMarkdownSections(source);
      assert.equal(
        result,
        `${prefix}### Title\n\n${' '.repeat(Math.max(0, childIndent - indent))}Text\n`,
      );
      assert.equal(parsePageSource(result).tree.children[1].type, 'paragraph');
    }
    const source = `${' '.repeat(indent)}:::section[Title]{id="tab"}\n\tText\n:::`;
    assert.equal(
      parsePageSource(flattenMarkdownSections(source)).tree.children[1].type,
      'paragraph',
    );
  }
});

test('lifting indented containers preserves tab stops and literal code tabs', () => {
  for (const indent of [1, 2, 3]) {
    const prefix = ' '.repeat(indent);
    for (const codePrefix of ['\t\t', '\t\t\t', ' \t\t', `${prefix}\t\t`]) {
      for (const fenced of [false, true]) {
        const body = fenced
          ? `${prefix}\`\`\`js\n${codePrefix}code();\n${prefix}\`\`\``
          : `${codePrefix}code();`;
        const source = `${prefix}:::section[Title]{id="tabs"}\n${body}\n:::`;
        const section = parsePageSource(source).tree.children[0];
        assert.equal(section.type, 'containerDirective');
        if (section.type !== 'containerDirective') assert.fail('Expected a section');
        const original = section.children[1];
        const result = parsePageSource(flattenMarkdownSections(source)).tree.children[1];
        assert.equal(original.type, 'code');
        assert.equal(result.type, 'code');
        if (original.type !== 'code' || result.type !== 'code') assert.fail('Expected code');
        assert.equal(result.value, original.value);
        assert.equal(result.lang, original.lang);
      }
    }
  }
});

test('ordinary Markdown, code examples and unknown wrappers remain byte-for-byte unchanged', () => {
  const sources = [
    '',
    '# Heading\n\nA paragraph.  \nAnother line.\n',
    '```md\n:::section[Example]{id="example"}\nText\n:::\n```\n',
    '    :::section[Code]{id="code"}\n    Text\n    :::\n',
    '::::custom-widget\n:::section[Opaque]{id="opaque"}\nText\n:::\n::::\n',
  ];
  for (const source of sources)
    assert.equal(flattenMarkdownSections(source, { preserveUnknown: true }), source);
});

test('invalid section syntax is rejected before any content can be lost', () => {
  for (const source of [
    ':::section[No ID]\nKeep\n:::',
    ':::section[Open]{id="open"}\nKeep',
    ':::section[Wrong attribute]{id="wrong" other="value"}\nKeep\n:::',
    ':::section[One]{id="same"}\nOne\n:::\n\n:::section[Two]{id="same"}\nTwo\n:::',
    '::::section[Outer]{id="outer"}\n:::section[Inner]{id="inner"}\nKeep\n:::\n::::',
  ])
    assert.throws(() => flattenMarkdownSections(source, { preserveUnknown: true }));
});
