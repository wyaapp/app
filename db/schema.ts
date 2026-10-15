import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
