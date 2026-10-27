import test from 'node:test';
import assert from 'node:assert/strict';
import { getFileFormat, isRichTextFile } from '../lib/file-formats.ts';
import { parseWidgetSource } from '../lib/widget-files.ts';
import { fileActionSchema, decodeTextFile } from '../lib/space-files.ts';
import { serializePageItem } from '../lib/page-documents.ts';
import type { LinkItem } from '../lib/profile-types.ts';

const discord: LinkItem = {
  kind: 'discord',
  slug: 'community',
  label: 'Community',
  platform: 'discord',
  url: '',
  visible: true,
  discord: { guildId: '771498135188799500' },
};

test('widget files use the existing text file boundary and centralized format classification', () => {
  assert.equal(getFileFormat('Community.WIDGET'), 'widget');
  assert.equal(getFileFormat('readme.md'), 'markdown');
  assert.equal(getFileFormat('notes.txt'), 'text');
  assert.equal(getFileFormat('widget'), null);
  assert.equal(getFileFormat('file.widget.html'), null);
  assert.equal(isRichTextFile('a.widget'), true);
  assert.equal(isRichTextFile('a.md'), true);
  assert.equal(isRichTextFile('a.txt'), false);
  assert.equal(
    fileActionSchema.safeParse({ action: 'create', name: 'a.widget', content: '' }).success,
    true,
  );
  assert.equal(
    fileActionSchema.safeParse({ action: 'create', name: '.widget', content: '' }).success,
    false,
  );
  const source = '```js\nconsole.log("Olá");\n```';
  assert.equal(decodeTextFile('Code.widget', new TextEncoder().encode(source).buffer), source);
});

test('widgets parse one Discord, GIF, hosted p5, or inert code block with existing vocabulary', () => {
  const community = parseWidgetSource(serializePageItem(discord));
  assert.equal(community?.kind, 'discord');
  if (community?.kind === 'discord')
    assert.equal(community.item.discord?.guildId, discord.discord?.guildId);
  assert.deepEqual(parseWidgetSource('::gif[Hello]{provider="giphy" id="YsTs5ltWtEhnq"}'), {
    kind: 'gif',
    gif: { provider: 'giphy', id: 'YsTs5ltWtEhnq', title: 'Hello' },
  });
  assert.deepEqual(
    parseWidgetSource('::p5{url="https://editor.p5js.org/alex/sketches/demo" title="Demo"}'),
    {
      kind: 'p5',
      sketch: { url: 'https://editor.p5js.org/alex/sketches/demo', title: 'Demo' },
    },
  );
  assert.deepEqual(
    parseWidgetSource(
      '```p5 {"url":"https://editor.p5js.org/alex/sketches/demo"}\nlegacy source\n```',
    ),
    {
      kind: 'p5',
      sketch: { url: 'https://editor.p5js.org/alex/sketches/demo', title: 'p5.js sketch' },
    },
  );
  assert.deepEqual(parseWidgetSource('```html\n<script>alert("inert code")</script>\n```'), {
    kind: 'code',
    language: 'html',
    code: '<script>alert("inert code")</script>',
  });
  assert.deepEqual(parseWidgetSource('~~~\nplain code\n~~~'), {
    kind: 'code',
    language: '',
    code: 'plain code',
  });
});

test('widget constraints reject extra blocks and unsupported wrappers without dropping content', () => {
  assert.equal(parseWidgetSource(' \n\n'), null);
  assert.throws(() => parseWidgetSource('', { allowEmpty: false }), /exactly one block/);
  for (const source of [
    '# A heading',
    'Ordinary prose',
    '<iframe src="https://example.com"></iframe>',
    '![Picture](https://example.com/photo.png)',
    '::unknown[Embed]{url="https://example.com"}',
    ':::section[Group]{id="group"}\n\n```js\ncode\n```\n\n:::',
    '> ```js\n> code\n> ```',
    '```js\ncode\n```\n\nA caption',
    '```js\ncode\n```\n\n```js\nmore code\n```',
    '```js\ncode\n```\n\n[unused]: https://example.com',
  ])
    assert.throws(() => parseWidgetSource(source), source);
});

test('reserved or unfinished embed syntax cannot fall through to a generic code widget', () => {
  for (const source of [
    '```p5\nsetup()\n```',
    '```p5 {"url":"https://evil.example/frame"}\nsource\n```',
    '```wya-item\n{"kind":"discord"}\n```',
    '```gif\ninvalid embed\n```',
    '```discord\ninvalid embed\n```',
    '::gif[Invalid]{provider="giphy" id="bad-id"}',
    '::p5{url="https://evil.example/frame"}',
    '```js\nunfinished',
    '    indented code',
    serializePageItem({ ...discord, discord: { guildId: 'invalid' } }),
    serializePageItem({ ...discord, kind: 'project' }),
  ])
    assert.throws(() => parseWidgetSource(source), source);
});
