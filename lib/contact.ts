import { AppError } from './app-error.ts';
import { consumeLimit, digestKey } from './abuse-limits.ts';
import { createAccountPlanService } from './account-plan-service.ts';
import { CONTACT_TOPICS, contactSchema } from './contact-schema.ts';
import { resolveHostingMode, type HostingMode } from './plans.ts';

export type ContactSender = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

type ContactSpace = { id: string; handle: string; name: string | null };

// Discord counts UTF-16 string length. Escape Markdown, then bound the output,
// leaving complete surrogate pairs and no dangling escape at a truncation point.
function discordText(value: string, maximum: number) {
  const escaped = value
    .slice(0, maximum)
    .replace(/[\uD800-\uDBFF]$/, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[\\`*_{}[\]()#+.!>|~<\-]/g, '\\$&');
  if (escaped.length <= maximum) return escaped;
  return (
    escaped
      .slice(0, maximum - 1)
      .replace(/[\uD800-\uDBFF]$/, '')
      .replace(/\\$/, '') + '…'
  );
}

function configuredOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Contact metadata is an explicit allowlist; never forward headers or auth objects. */
export async function submitContact(
  input: unknown,
  sender: ContactSender,
  {
    db,
    webhook,
    origin,
    hostingMode = 'self-hosted',
    fetcher = fetch,
    now = Date.now,
    newReference = () => crypto.randomUUID(),
  }: {
    db: D1Database;
    webhook?: string;
    origin: string;
    hostingMode?: HostingMode;
    fetcher?: typeof fetch;
    now?: () => number;
    newReference?: () => string;
  },
) {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError('Choose a support topic and write between 10 and 1,800 characters.', 400);
  const sourceOrigin = configuredOrigin(origin);
  if (
    !sourceOrigin ||
    !webhook ||
    webhook.trim() !== webhook ||
    !/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(webhook)
  )
    throw new AppError('Support is unavailable. Please email contact@wya.im.', 503);

  const mode = resolveHostingMode(hostingMode);
  const time = now();
  const owner = await digestKey(sender.userId);
  await consumeLimit(db, `contact-hour:${owner}`, 3, 3_600_000, time);
  await consumeLimit(db, `contact-day:${owner}`, 10, 86_400_000, time);
  await consumeLimit(db, 'contact-minute', 30, 60_000, time);

  const { topic, message, spaceId, locale } = parsed.data;
  let space: ContactSpace | null = null;
  if (spaceId) {
    space = await db
      .prepare(
        "SELECT id, handle, json_extract(data, '$.name') AS name FROM spaces WHERE user_id = ? AND id = ?",
      )
      .bind(sender.userId, spaceId)
      .first<ContactSpace>();
    if (!space) throw new AppError('Space not found.', 404);
  }
  const plan = await createAccountPlanService(db, mode, () => time).get(sender.userId);
  const reference = newReference();
  const fields = [
    { name: 'Account ID', value: discordText(sender.userId, 400), inline: false },
    {
      name: 'Name',
      value: discordText(sender.fullName || sender.displayName, 160) || 'Not set',
      inline: true,
    },
    {
      name: 'Display name',
      value: discordText(sender.displayName, 120) || 'Not set',
      inline: true,
    },
    { name: 'Email', value: discordText(sender.email, 512), inline: true },
    { name: 'Hosting', value: mode, inline: true },
    {
      name: 'Plan',
      value: mode === 'self-hosted' ? 'All features included' : plan.plan,
      inline: true,
    },
    { name: 'Language', value: locale ?? 'Not provided', inline: true },
    { name: 'Site', value: discordText(sourceOrigin, 200), inline: false },
  ];
  if (space) {
    fields.push(
      { name: 'Space ID', value: discordText(space.id, 400), inline: false },
      { name: 'Space name', value: discordText(space.name || '', 160) || 'Not set', inline: true },
      { name: 'Handle', value: discordText(`@${space.handle}`, 164), inline: true },
    );
  }

  const body = {
    username: 'wya.im support',
    allowed_mentions: { parse: [] },
    // URLs in embed text do not produce content-link unfurls. SUPPRESS_EMBEDS
    // would hide these intentional embeds too, so never set that flag here.
    embeds: [
      {
        title: `Support: ${CONTACT_TOPICS[topic]}`,
        description: discordText(message, 3600),
        timestamp: new Date(time).toISOString(),
        fields,
        footer: { text: `Contact ${reference} · Support app` },
      },
    ],
  };

  try {
    const response = await fetcher(`${webhook}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Workers supports manual redirects, not redirect: 'error'. Reject 3xx
      // below so the webhook secret or private message cannot be redirected.
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (response.status === 429)
      throw new AppError('Support is busy. Please try again in a few minutes.', 429);
    if (!response.ok) throw new Error('Delivery failed');
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Upstream bodies and errors may contain the webhook or private account data.
    throw new AppError('Could not confirm delivery. Please try again later.', 502);
  }
  return { sent: true as const, reference };
}
