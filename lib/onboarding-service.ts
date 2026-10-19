import { AppError } from './app-error.ts';
import { limitMutation } from './abuse-limits.ts';
import { onboardingSchema, type Onboarding } from './onboarding.ts';

/** Private account research. Never part of space JSON, revisions, or MCP output. */
export function createOnboardingService(db: D1Database) {
  async function get(userId: string): Promise<Onboarding | null> {
    return db
      .prepare(
        'SELECT status, occupation, purpose, discovery FROM account_onboarding WHERE user_id = ?',
      )
      .bind(userId)
      .first<Onboarding>();
  }

  async function save(userId: string, input: unknown): Promise<Onboarding> {
    const parsed = onboardingSchema.safeParse(input);
    if (!parsed.success) throw new AppError('Choose one of the listed answers, or leave it blank.');
    await limitMutation(db, userId);
    const value: Onboarding =
      parsed.data.action === 'skip'
        ? { status: 'skipped', occupation: null, purpose: null, discovery: null }
        : {
            status: 'completed',
            occupation: parsed.data.occupation,
            purpose: parsed.data.purpose,
            discovery: parsed.data.discovery,
          };
    await db
      .prepare(
        `INSERT INTO account_onboarding (user_id, status, occupation, purpose, discovery, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, occupation = excluded.occupation,
        purpose = excluded.purpose, discovery = excluded.discovery, updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        value.status,
        value.occupation,
        value.purpose,
        value.discovery,
        new Date().toISOString(),
      )
      .run();
    return value;
  }
  return { get, save };
}
