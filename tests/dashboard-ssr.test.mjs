import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { build } from 'esbuild';

test('dashboard server render never imports workspace, editors, or file parsers', async () => {
  const { outputFiles } = await build({
    entryPoints: ['app/dashboard/bootstrap.tsx'],
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/*', 'next/*'],
    plugins: [
      {
        name: 'reject-server-workspace-import',
        setup(builder) {
          builder.onLoad({ filter: /\/dashboard\/workspace\.tsx$/ }, () => ({
            contents: `throw new Error('Dashboard workspace imported on the server');
            export default function Dashboard() { return null; }`,
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
      createElement(compiled.exports.DashboardBootstrap, {
        section: 'files',
        displayName: 'Test',
        signOut: '/signout',
        standalone: true,
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
  assert.match(html, /class="simple-dashboard"/);
  assert.match(html, /Loading/);
});
