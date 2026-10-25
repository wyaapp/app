import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Root } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import {
  imageDisplayMaxWidth,
  imageMarkdownNode,
  normalizeImageEmbed,
  parseImageDirective,
  parseImageUrl,
  type ImageEmbed,
} from '../lib/image.ts';
import { imageFromMarker, remarkImageEmbeds } from '../lib/remark-images.ts';
import { remarkGifEmbeds } from '../lib/remark-gif.ts';
import { parsePageSource, stringifyPageTree } from '../lib/page-documents.ts';
import {
  Editor,
  getSchema,
  createRichDocumentExtensions,
  markdownToRichDocument,
  richDocumentToMarkdown,
} from './helpers/rich-editor.ts';

const parser = unified().use(remarkParse).use(remarkDirective);

test('direct image detection checks the path, retains the original URL, and ignores query suffixes', () => {
  for (const extension of ['gif', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'apng', 'bmp', 'PNG']) {
    const src = `https://media.example.com/photo.${extension}?token=unchanged#original`;
    assert.deepEqual(parseImageUrl(`  ${src}\n`), { src });
  }
  for (const src of [
    'https://example.com/photo.svg',
    'https://example.com/page?file=photo.gif',
    'https://example.com/photo.png/other',
    'https://example.com/photo%2epng',
    'https://example.com/photo.png another',
    'https://example.com/photo.png\nhttps://example.com/other.png',
    'http://example.com/photo.png',
    'data:image/png;base64,SGVsbG8=',
    'javascript:alert(1).gif',
    '//example.com/photo.png',
    'https://user:password@example.com/photo.png',
    'https://example.com:8080/photo.png',
    'https://example.com/path\\photo.png',
  ])
    assert.equal(parseImageUrl(src), null, src);
});

test('image validation permits extensionless HTTPS Markdown sources but validates presentation data', () => {
  const src = 'https://images.example.com/id/123?format=webp';
  assert.deepEqual(normalizeImageEmbed({ src, alt: null, title: null, size: null }), { src });
  assert.equal(parseImageUrl(src), null);
  assert.equal(imageDisplayMaxWidth({}), 384);
  for (const size of [120, 1920, 'full'] as const) {
    assert.deepEqual(normalizeImageEmbed({ src, size }), { src, size });
    assert.equal(imageDisplayMaxWidth({ size }), size === 'full' ? 'none' : size);
  }
  for (const invalid of [
    { src: 'javascript:alert(1)' },
    { src, size: 119 },
    { src, size: 1921 },
    { src, size: 384.5 },
    { src, size: '384' },
    { src, alt: '<script>\0' },
    { src, title: 42 },
  ])
    assert.equal(normalizeImageEmbed(invalid), null);
});

test('image insertion commands refuse unsafe sources without changing the document', () => {
  const editor = new Editor({
    element: null,
    extensions: createRichDocumentExtensions(),
    content: markdownToRichDocument('Keep this paragraph.'),
  });
  try {
    const original = editor.state.doc;
    for (const src of ['javascript:alert(1)', 'data:image/png;base64,SGVsbG8=', '/relative.png']) {
      assert.equal(editor.commands.setImage({ src }), false);
      assert.ok(editor.state.doc.eq(original));
    }
    assert.equal(
      editor.commands.setImage({ src: 'https://example.com/photo.png', alt: 'Photo' }),
      true,
    );
    assert.match(
      richDocumentToMarkdown(editor.getJSON()),
      /!\[Photo\]\(https:\/\/example.com\/photo.png\)/,
    );
  } finally {
    editor.destroy();
  }
});

test('unsupported and inline image source survives other edits byte for byte', () => {
  const input =
    '![relative](/assets/photo.png)\n\n![unsupported](data:image/png;base64,abcd)\n\nText ![inline](https://example.com/image.png) after.\n\nEdit me.\n';
  const document = markdownToRichDocument(input);
  document.content!.at(-1)!.content![0].text = 'Edited.';
  const output = richDocumentToMarkdown(document, input);
  assert.ok(output.includes('![relative](/assets/photo.png)'));
  assert.ok(output.includes('![unsupported](data:image/png;base64,abcd)'));
  assert.ok(output.includes('Text ![inline](https://example.com/image.png) after.'));
  assert.ok(output.includes('Edited.'));
});

test('default images stay portable Markdown; custom sizes and escaped labels round trip', () => {
  const editorSchema = getSchema(createRichDocumentExtensions());
  for (const size of [undefined, 240, 'full'] as const) {
    const image: ImageEmbed = {
      src: 'https://images.example.com/cat.png?width=600&token=original',
      alt: 'A **cat** [here] & <friend> :wave:',
      title: 'A "title" & more',
      ...(size !== undefined ? { size } : {}),
    };
    const source = stringifyPageTree({ type: 'root', children: [imageMarkdownNode(image)] });
    if (size === undefined) assert.ok(source.startsWith('!['));
    else assert.ok(source.startsWith('::image['));
    for (const options of [{}, { wya: false }]) {
      const document = markdownToRichDocument(source, options);
      assert.deepEqual(document.content?.[0], { type: 'image', attrs: image });
      const instance = editorSchema.nodeFromJSON(document);
      instance.check();
      assert.equal(richDocumentToMarkdown(instance.toJSON(), source, options), source);
      const edited = instance.toJSON();
      edited.content![0].attrs!.size = 640;
      const changed = richDocumentToMarkdown(edited, source, options);
      assert.deepEqual(markdownToRichDocument(changed, options).content?.[0].attrs, {
        ...image,
        size: 640,
      });
    }
    assert.doesNotThrow(() => parsePageSource(source));
  }
});

test('images remain schema-safe within sections, quotes and lists', () => {
  const source =
    '> ![A cat](https://example.com/cat.png)\n\n- ![A dog](https://example.com/dog.webp)\n\n:::section[Photos]{id="photos"}\n::image[Bird]{src="https://example.com/bird.jpg" size="full"}\n:::\n';
  const document = markdownToRichDocument(source);
  const editorSchema = getSchema(createRichDocumentExtensions());
  assert.doesNotThrow(() => editorSchema.nodeFromJSON(document).check());
  assert.equal(richDocumentToMarkdown(document, source), source);
});

test('invalid image directives cannot be published or interpreted as media', () => {
  for (const source of [
    '::image{src="javascript:alert(1)"}',
    '::image{src="https://example.com/cat.png" size="0384"}',
    '::image{src="https://example.com/cat.png" size="100%"}',
    '::image{src="https://example.com/cat.png" onerror="alert(1)"}',
    '::image[**cat**]{src="https://example.com/cat.png"}',
  ]) {
    assert.equal(parseImageDirective(parser.parse(source).children[0]), null, source);
    assert.throws(() => parsePageSource(source), /valid HTTPS image/);
    const plain = markdownToRichDocument(source, { wya: false });
    assert.equal(plain.content?.[0].type, 'markdownBlock');
    assert.equal(richDocumentToMarkdown(plain, source, { wya: false }), source);
  }
});

test('public Markdown rendering recognizes standard and resized images without consuming inline prose', () => {
  const processor = parser().use(remarkGifEmbeds, { preserveUnknown: true }).use(remarkImageEmbeds);
  const source =
    '![Cat](https://example.com/cat.png "Cat title")\n\n::image[Dog]{src="https://example.com/dog.png" size="full"}\n\nBefore ![inline](https://example.com/inline.png) after.\n';
  const tree = processor.runSync(processor.parse(source), source) as Root;
  assert.deepEqual(imageFromMarker(tree.children[0].data?.hProperties), {
    src: 'https://example.com/cat.png',
    alt: 'Cat',
    title: 'Cat title',
  });
  assert.deepEqual(imageFromMarker(tree.children[1].data?.hProperties), {
    src: 'https://example.com/dog.png',
    alt: 'Dog',
    size: 'full',
  });
  assert.equal(tree.children[2].data?.hName, undefined);
  assert.equal(imageFromMarker({ 'data-wya-image': '{broken' }), null);
  assert.equal(imageFromMarker({ 'data-wya-image': '{"src":"javascript:alert(1)"}' }), null);
});
