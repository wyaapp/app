import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const spaces = sqliteTable(
  'spaces',
  {
    pictureKey: text('picture_key'),
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    handle: text('handle').notNull().unique(),
    data: text('data').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('spaces_owner').on(table.userId, table.createdAt, table.id),
    uniqueIndex('spaces_picture_key').on(table.pictureKey),
  ],
);
// Current username plus, at most, one reclaimable previous username per space.
export const spaceHandles = sqliteTable(
  'space_handles',
  {
    handle: text('handle').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('space_handles_space').on(table.spaceId)],
);
export const spaceRevisions = sqliteTable(
  'space_revisions',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    version: integer('version').notNull(),
    data: text('data').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('space_revision_version').on(table.spaceId, table.version)],
);

export const pictureObjects = sqliteTable(
  'picture_objects',
  {
    key: text('key').primaryKey(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('picture_objects_created').on(table.createdAt)],
);

export const securityLimits = sqliteTable(
  'security_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('security_limits_expiry').on(table.expiresAt)],
);
export const authMailLocks = sqliteTable(
  'auth_mail_locks',
  {
    recipient: text('recipient').primaryKey(),
    owner: text('owner').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('auth_mail_locks_expiry').on(table.expiresAt)],
);

// Account-level survey; deliberately separate from public spaces and revisions.
export const accountOnboarding = sqliteTable('account_onboarding', {
  userId: text('user_id').primaryKey(),
  status: text('status', { enum: ['completed', 'skipped'] }).notNull(),
  occupation: text('occupation'),
  purpose: text('purpose'),
  discovery: text('discovery'),
  updatedAt: text('updated_at').notNull(),
});

export const spaceFileFolders = sqliteTable(
  'space_file_folders',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => spaceFileFolders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    system: text('system', { enum: ['desktop'] }),
  },
  (table) => [
    uniqueIndex('space_file_folders_system').on(table.spaceId, table.system),
    uniqueIndex('space_file_folders_name').on(
      table.spaceId,
      sql`COALESCE(${table.parentId}, '')`,
      sql`${table.name} COLLATE NOCASE`,
    ),
  ],
);

export const spaceFiles = sqliteTable(
  'space_files',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    folderId: text('folder_id').references(() => spaceFileFolders.id, { onDelete: 'cascade' }),
    content: text('content').notNull().default(''),
    version: integer('version').notNull().default(1),
    publishedName: text('published_name'),
    publishedContent: text('published_content'),
    publishedAt: text('published_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('space_files_name').on(
      table.spaceId,
      sql`COALESCE(${table.folderId}, '')`,
      sql`${table.name} COLLATE NOCASE`,
    ),
    index('space_files_public').on(table.spaceId, table.publishedAt),
  ],
);

export const spacePageFiles = sqliteTable(
  'space_page_files',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    tabId: text('tab_id').notNull(),
    folderId: text('folder_id').references(() => spaceFileFolders.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.tabId] }),
    index('space_page_files_folder').on(table.folderId),
  ],
);

// Ownership and provider state are independent from editable profile revisions.
export const spaceDomains = sqliteTable(
  'space_domains',
  {
    spaceId: text('space_id')
      .primaryKey()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: integer('verified_at'),
    providerId: text('provider_id').unique(),
    hostnameStatus: text('hostname_status').notNull().default('pending'),
    sslStatus: text('ssl_status').notNull().default('pending'),
    dnsReady: integer('dns_ready').notNull().default(0),
    records: text('records').notNull().default('[]'),
    redirect: integer('redirect').notNull().default(0),
    removing: integer('removing').notNull().default(0),
    checkedAt: integer('checked_at').notNull().default(0),
    attemptedAt: integer('attempted_at').notNull().default(0),
    lockId: text('lock_id'),
    lockUntil: integer('lock_until').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('space_domains_verified_host')
      .on(table.hostname)
      .where(sql`${table.verifiedAt} IS NOT NULL`),
    index('space_domains_host').on(table.hostname),
    index('space_domains_attempted').on(table.attemptedAt),
  ],
);
