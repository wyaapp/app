import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

type RichEditorModules = Pick<typeof import('@tiptap/core'), 'Editor' | 'getSchema'> &
  Pick<
    typeof import('@tiptap/pm/state'),
    'EditorState' | 'NodeSelection' | 'TextSelection' | 'Selection'
  > &
  Pick<typeof import('@tiptap/pm/commands'), 'wrapIn'> &
  Pick<typeof import('@tiptap/pm/schema-list'), 'wrapInList'> &
  Pick<typeof import('@tiptap/pm/history'), 'history' | 'undo' | 'redo'> &
  Pick<typeof import('@tiptap/pm/model'), 'Slice' | 'Fragment'> &
  Pick<
    typeof import('../../lib/rich-document-media-paste.ts'),
    'createMediaPaste' | 'mediaPasteKey' | 'mediaBlockToLink' | 'mediaBlockUrl'
  > &
  Pick<typeof import('../../lib/rich-document-schema.ts'), 'createRichDocumentExtensions'> &
  Pick<
    typeof import('../../lib/rich-document-badges.ts'),
    'insertRichBadge' | 'createBadgePaste' | 'badgePasteKey'
  > &
  Pick<typeof import('../../lib/rich-document-p5.ts'), 'createP5Paste' | 'p5PasteKey'> &
  Pick<typeof import('../../lib/rich-document-insertion.ts'), 'insertRichBlock'> &
  Pick<
    typeof import('../../lib/rich-document-clipboard.ts'),
    'createBlockClipboard' | 'blockClipboardKey'
  > &
  Pick<
    typeof import('../../lib/rich-document.ts'),
    'markdownToRichDocument' | 'richDocumentToMarkdown'
  >;

// Match the browser bundler's ESM resolution. Native Node would load codemark's
// CommonJS entry alongside Tiptap's ESM entry, creating two ProseMirror class/key
// registries. Bundle the complete real editor instead of filtering plugin keys.
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { Editor, getSchema } from '@tiptap/core';
      export { EditorState, NodeSelection, TextSelection, Selection } from '@tiptap/pm/state';
      export { wrapIn } from '@tiptap/pm/commands';
      export { wrapInList } from '@tiptap/pm/schema-list';
      export { history, undo, redo } from '@tiptap/pm/history';
      export { Slice, Fragment } from '@tiptap/pm/model';
      export { createMediaPaste, mediaPasteKey, mediaBlockToLink, mediaBlockUrl } from './lib/rich-document-media-paste';
      export { createRichDocumentExtensions } from './lib/rich-document-schema';
      export { insertRichBadge, createBadgePaste, badgePasteKey } from './lib/rich-document-badges';
      export { createP5Paste, p5PasteKey } from './lib/rich-document-p5';
      export { insertRichBlock } from './lib/rich-document-insertion';
      export { createBlockClipboard, blockClipboardKey } from './lib/rich-document-clipboard';
      export { markdownToRichDocument, richDocumentToMarkdown } from './lib/rich-document';
    `,
    resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  mainFields: ['module', 'main'],
  logLevel: 'silent',
});
const compiled = { exports: {} as RichEditorModules };
new Function('require', 'module', 'exports', outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);

export type Editor = import('@tiptap/core').Editor;
export const {
  Editor,
  getSchema,
  EditorState,
  NodeSelection,
  TextSelection,
  Selection,
  wrapIn,
  wrapInList,
  history,
  undo,
  redo,
  Slice,
  Fragment,
  createMediaPaste,
  mediaPasteKey,
  mediaBlockToLink,
  mediaBlockUrl,
  createRichDocumentExtensions,
  insertRichBadge,
  createBadgePaste,
  badgePasteKey,
  createP5Paste,
  p5PasteKey,
  insertRichBlock,
  createBlockClipboard,
  blockClipboardKey,
  markdownToRichDocument,
  richDocumentToMarkdown,
} = compiled.exports;
