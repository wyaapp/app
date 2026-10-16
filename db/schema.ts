import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey(),
  handle: text('handle').notNull().unique(),
  data: text('data').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const revisions = sqliteTable('revisions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => profiles.userId),
  version: integer('version').notNull(),
  data: text('data').notNull(),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [uniqueIndex('revision_user_version').on(table.userId, table.version)]);

// Legacy tables above are retained for the migration bridge, not new application writes.
export const spaces = sqliteTable('spaces', {
  pictureKey: text('picture_key'),
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  handle: text('handle').notNull().unique(),
  data: text('data').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('spaces_owner').on(table.userId, table.createdAt, table.id), uniqueIndex('spaces_picture_key').on(table.pictureKey)]);
export const spaceHandles = sqliteTable('space_handles', {
  handle: text('handle').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  createdAt: text('created_at').notNull(),
}, table => [index('space_handles_space').on(table.spaceId)]);
export const spaceRevisions = sqliteTable('space_revisions', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  version: integer('version').notNull(),
  data: text('data').notNull(),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [uniqueIndex('space_revision_version').on(table.spaceId, table.version)]);

export const pictureObjects = sqliteTable('picture_objects', {
  key: text('key').primaryKey(),
  createdAt: text('created_at').notNull(),
}, table => [index('picture_objects_created').on(table.createdAt)]);
