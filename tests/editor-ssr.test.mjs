import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { build } from 'esbuild';

test('server rendering never imports the browser editor, even when streaming finishes', async () => {
  const { outputFiles } = await build({
    entryPoints: ['app/components/document-editor/lazy-rich-markdown-editor.tsx'],
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/*', 'next/*'],
    plugins: [
      {
        name: 'reject-server-editor-import',
        setup(builder) {
          builder.onLoad({ filter: /\/rich-markdown-editor\.tsx$/ }, () => ({
            contents: `throw new Error('Browser editor imported on the server');
            export function RichMarkdownEditor() { return null; }`,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(
    createRequire(import.meta.url),
    compiled,
    compiled.exports,
  );
  const errors = [];
  const html = await new Promise((resolve, reject) => {
    let result = '';
    const output = new Writable({
      write(chunk, _encoding, callback) {
        result += chunk;
        callback();
      },
      final(callback) {
        resolve(result);
        callback();
      },
    });
    const stream = renderToPipeableStream(
      createElement(compiled.exports.LazyRichMarkdownEditor, {
        source: '# Document\n\n```js\nconst value = 1;\n```',
        onChange() {},
      }),
      {
        onAllReady() {
          stream.pipe(output);
        },
        onShellError: reject,
        onError(error) {
          errors.push(error);
        },
      },
    );
  });
  assert.deepEqual(errors, []);
  assert.match(html, /class="rich-editor-loading"/);
  assert.match(html, /Loading/);
});
