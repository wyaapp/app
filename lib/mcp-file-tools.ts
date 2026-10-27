import { z } from 'zod';
import { fileActionSchema } from './space-files.ts';
import { trashActionSchema } from './space-trash.ts';

export const mcpFileActions = {
  create_file: 'create',
  save_file: 'save',
  publish_file: 'publish',
  unpublish_file: 'unpublish',
  move_file: 'move',
  delete_file: 'delete',
  file_properties: 'properties',
  restore_trash: 'restore-trash',
  permanently_delete: 'purge-trash',
  empty_trash: 'empty-trash',
} as const;

const descriptions: Record<keyof typeof mcpFileActions, string> = {
  restore_trash:
    'Restore one Trash entry, including all folder contents, as private drafts. Read list_trash first and use the entry ID and version. Existing names are preserved with a suffix on conflict; a missing original folder falls back to Home.',
  permanently_delete:
    'Permanently delete a Trash entry and its contents, including their retained content history. This cannot be undone. Only use when the user explicitly requests permanent deletion; use the ID and version from list_trash.',
  empty_trash:
    'Permanently delete the listed Trash entries and their contents. Requires explicit user intent to empty Trash. Pass the exact ID/version snapshot from list_trash; newly deleted items not in that snapshot are retained. This cannot be undone.',
  create_file:
    'Create a private Markdown (.md), plain-text (.txt), or single-block (.widget) file. A widget contains one Discord, GIF, p5.js, or code block using the same Markdown syntax; empty widget drafts are allowed. Content is UTF-8 text, up to 128 KiB. Use publish_file only when the user asks to make it public.',
  save_file:
    'Save the complete private draft of an existing file using its current file version. Preserve content the user did not ask to change. Renaming .widget to .md preserves content and identity; renaming to .widget requires one supported block. Saving does not publish the draft.',
  publish_file:
    'Publish the saved file draft to visitors. Read the file first and use its current version. This also updates short links for its visible cards.',
  unpublish_file:
    'Hide a file from visitors and disable its published short links. Keep its content as a private draft.',
  move_file:
    'Move a file into a folder, or to the root with folderId:null. Moving does not change publication.',
  delete_file:
    'Move a file to Trash and hide its published content. It can be restored later as a private draft. Read it first and obtain explicit user intent before deleting.',
  file_properties:
    'Update a file name and its navigation settings using its current file version. This does not publish draft content.',
};

const selector = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe('Owned space ID from list_spaces. Omit only when the account has exactly one space.');
export const mcpFileReadSchema = z.object({ spaceId: selector, id: z.uuid() }).strict();

export const fileTools = [
  {
    name: 'list_files',
    description:
      'List files and folders in an owned space, including stable IDs, file versions, publication status, names, and placement. Files are the single content model for the space.',
    inputSchema: z.toJSONSchema(z.object({ spaceId: selector }).strict()),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'read_file',
    description:
      'Read a file and its private draft before editing or publishing it. The returned file version is required for changes.',
    inputSchema: z.toJSONSchema(mcpFileReadSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_trash',
    description:
      'List privately retained deleted files and folders, including Trash entry IDs, versions, original locations, and deletion dates. This does not expose file contents to visitors.',
    inputSchema: z.toJSONSchema(z.object({ spaceId: selector }).strict()),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  ...Object.entries(mcpFileActions).flatMap(([name, action]) => {
    const schema = [...fileActionSchema.options, ...trashActionSchema.options].find(
      (option) => option.shape.action.value === action,
    );
    if (!schema) return [];
    const { action: _action, ...fields } = schema.shape;
    void _action;
    return [
      {
        name,
        description: descriptions[name as keyof typeof descriptions],
        inputSchema: z.toJSONSchema(z.object({ ...fields, spaceId: selector }).strict(), {
          io: 'input',
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: ['delete', 'purge-trash', 'empty-trash'].includes(action),
          openWorldHint: false,
        },
      },
    ];
  }),
];
