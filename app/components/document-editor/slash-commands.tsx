'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import type { createTranslator } from '@/lib/i18n/translate';
import {
  BlockMenu,
  blockChoices,
  type BlockKind,
  type BlockMenuHandle,
  type BlockMenuAccessibility,
} from './block-menu';

export const blockSuggestionKey = new PluginKey('wyaBlockSuggestions');

export function createSlashCommands({
  wya,
  t,
  onChoose,
}: {
  wya: boolean;
  t: ReturnType<typeof createTranslator>;
  onChoose: (editor: Editor, kind: BlockKind, range: Range) => void;
}) {
  return Extension.create({
    name: 'wyaSlashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey: blockSuggestionKey,
          char: '/',
          startOfLine: false,
          allowSpaces: true,
          allow: ({ state, range }) => {
            const at = state.doc.resolve(range.from);
            return (
              at.parent.type.name === 'paragraph' &&
              state.doc.resolve(range.to).parent === at.parent &&
              !(state.storedMarks ?? at.marks()).some((mark) => mark.type.spec.code)
            );
          },
          items: ({ editor, query }) => {
            const { $from } = editor.state.selection;
            const standalone =
              $from.parent.textContent === `/${query}` &&
              $from.parent.content.size === query.length + 1 &&
              ['doc', 'wyaSection'].includes($from.node(-1).type.name);
            return blockChoices(t, wya, query).filter(
              (choice) => standalone || choice.id === 'badge',
            );
          },
          command: ({ editor, range, props }) => {
            exitSuggestion(editor.view, blockSuggestionKey);
            onChoose(editor, props as BlockKind, range);
          },
          render: () => {
            let component: ReactRenderer<BlockMenuHandle> | undefined;
            let unmount: (() => void) | undefined;
            let editorElement: HTMLElement | undefined;
            let originalAttributes: Map<string, string | null> | undefined;
            const attributes = [
              'aria-controls',
              'aria-activedescendant',
              'aria-autocomplete',
              'aria-haspopup',
            ];
            const onActiveChange = ({ listId, activeId }: BlockMenuAccessibility) => {
              if (!editorElement) return;
              editorElement.setAttribute('aria-controls', listId);
              editorElement.setAttribute('aria-autocomplete', 'list');
              editorElement.setAttribute('aria-haspopup', 'listbox');
              if (activeId) editorElement.setAttribute('aria-activedescendant', activeId);
              else editorElement.removeAttribute('aria-activedescendant');
            };
            return {
              onStart: (props) => {
                editorElement = props.editor.view.dom;
                originalAttributes = new Map(
                  attributes.map((name) => [name, editorElement!.getAttribute(name)]),
                );
                component = new ReactRenderer(BlockMenu, {
                  editor: props.editor,
                  props: { items: props.items, onChoose: props.command, t, onActiveChange },
                });
                component.element.className = 'rich-slash-popup';
                unmount = props.mount(component.element, { autoUpdate: { animationFrame: true } });
              },
              onUpdate: (props) =>
                component?.updateProps({
                  items: props.items,
                  onChoose: props.command,
                  t,
                  onActiveChange,
                }),
              onKeyDown: ({ event, view }) => {
                if (event.key === 'Escape') {
                  exitSuggestion(view, blockSuggestionKey);
                  return true;
                }
                return component?.ref?.onKeyDown(event) ?? false;
              },
              onExit: () => {
                for (const [name, value] of originalAttributes ?? []) {
                  if (value === null) editorElement?.removeAttribute(name);
                  else editorElement?.setAttribute(name, value);
                }
                editorElement = undefined;
                originalAttributes = undefined;
                unmount?.();
                component?.destroy();
              },
            };
          },
        }),
      ];
    },
  });
}
