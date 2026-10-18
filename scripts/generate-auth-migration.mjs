// Generates only new auth tables; application tables remain owned by Drizzle.
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { createAccountAuth } from '../lib/auth/config.ts';
import { writeFile } from 'node:fs/promises';
const database = new DatabaseSync(':memory:');
const auth = createAccountAuth(
  database,
  'schema-only-not-a-deployed-secret-123456789',
  'http://localhost:8787',
  async () => {},
);
const migration = await getMigrations(auth.options);
const sql = await migration.compileMigrations();
await writeFile(
  'drizzle/0001_auth.sql',
  '-- Generated from Better Auth 1.7.10. Additive auth tables; no profile ownership changes.\n' +
    sql +
    '\nCREATE TABLE auth_mail_limits (key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);\nCREATE INDEX auth_mail_limits_expiry ON auth_mail_limits(expires_at);\n',
);
console.log('Generated additive auth migration.');
