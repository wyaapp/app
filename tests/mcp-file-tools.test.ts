import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileTools, mcpFileActions, mcpFileReadSchema } from '../lib/mcp-file-tools.ts';

test('MCP file discovery generates serializable input schemas, including appearance transforms', () => {
  assert.deepEqual(
    fileTools.map((tool) => tool.name),
    ['list_files', 'read_file', 'list_trash', ...Object.keys(mcpFileActions)],
  );
  for (const tool of fileTools) {
    const schema = JSON.parse(JSON.stringify(tool.inputSchema));
    assert.equal(schema.type, 'object', tool.name);
    assert.equal(schema.additionalProperties, false, tool.name);
    assert.ok(schema.properties.spaceId, tool.name);
    assert.equal(schema.properties.action, undefined, tool.name);
    if (
      !['list_files', 'list_trash', 'read_file', 'create_file', 'empty_trash'].includes(tool.name)
    ) {
      assert.ok(schema.required.includes('id'), tool.name);
      assert.ok(schema.required.includes('version'), tool.name);
    }
  }
  const save = fileTools.find((tool) => tool.name === 'save_file')!;
  assert.ok(save.inputSchema.properties?.appearance);
  assert.equal(save.annotations.destructiveHint, false);
  assert.equal(
    fileTools.find((tool) => tool.name === 'delete_file')!.annotations.destructiveHint,
    true,
  );
});

test('file read tools reject cross-account selectors and non-file IDs', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.ok(mcpFileReadSchema.safeParse({ id, spaceId: 'owned-space' }).success);
  assert.equal(mcpFileReadSchema.safeParse({ id, userId: 'another-user' }).success, false);
  assert.equal(mcpFileReadSchema.safeParse({ id: 'home' }).success, false);
});

test('Trash tools require versioned entries and label irreversible actions', () => {
  for (const name of ['permanently_delete', 'empty_trash']) {
    assert.equal(fileTools.find((tool) => tool.name === name)!.annotations.destructiveHint, true);
  }
  assert.equal(
    fileTools.find((tool) => tool.name === 'restore_trash')!.annotations.destructiveHint,
    false,
  );
  const empty = JSON.parse(
    JSON.stringify(fileTools.find((tool) => tool.name === 'empty_trash')!.inputSchema),
  );
  assert.ok(empty.required.includes('entries'));
  assert.deepEqual(empty.properties.entries.items.required, ['id', 'version']);
  assert.equal(empty.properties.entries.minItems, 1);
});
