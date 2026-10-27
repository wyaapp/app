import { AppError } from './app-error.ts';
import { consumeLimit, digestKey, RateLimitError, reserveLimits } from './abuse-limits.ts';
import { createAccountPlanService } from './account-plan-service.ts';
import { configuredOrigin, discordText } from './discord-message.ts';
import { resolveHostingMode, type HostingMode } from './plans.ts';
import { REPORT_TOPICS, reportSchema } from './report-schema.ts';

export type ReportSender = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

type ReportSpace = { id: string; handle: string; name: string | null };

/** A single trusted reporting flow; callers supply only their destination webhook. */
export async function submitReport(
  input: unknown,
  sender: ReportSender,
  {
    db,
    webhook,
    origin,
    hostingMode = 'self-hosted',
    fetcher = fetch,
    now = Date.now(),
    newReference = () => crypto.randomUUID(),
  }: {
    db: D1Database;
    webhook?: string;
    origin: string;
    hostingMode?: HostingMode;
    fetcher?: typeof fetch;
    now?: number;
    newReference?: () => string;
  },
) {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) throw new AppError('Write between 10 and 1,800 characters.', 400);
  const sourceOrigin = configuredOrigin(origin);
  if (
    !sourceOrigin ||
    !webhook ||
    webhook.trim() !== webhook ||
    !/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(webhook)
  )
    throw new AppError('Messaging is unavailable. Please email support@wya.im.', 503);

  const { message, spaceId, locale, topic } = parsed.data;
  let space: ReportSpace | null = null;
  if (spaceId) {
    space = await db
      .prepare(
        "SELECT id, handle, json_extract(data, '$.name') AS name FROM spaces WHERE user_id = ? AND id = ?",
      )
      .bind(sender.userId, spaceId)
      .first<ReportSpace>();
    if (!space) throw new AppError('Space not found.', 404);
  }
  const mode = resolveHostingMode(hostingMode);
  const plan = await createAccountPlanService(db, mode, () => now).get(sender.userId);
  const reference = newReference().slice(0, 80);
  // Identity is supplied by the verified session; only an owned space is used.
  // Explicit field limits keep the entire embed below Discord's 6,000-character cap.
  const fields = [
    {
      name: 'Reporter',
      value: discordText(sender.fullName || sender.displayName, 160) || 'Not set',
      inline: true,
    },
    { name: 'Email', value: discordText(sender.email, 320) || 'Not set', inline: true },
    {
      name: 'Display name',
      value: discordText(sender.displayName, 120) || 'Not set',
      inline: true,
    },
    { name: 'Account ID', value: discordText(sender.userId, 256), inline: false },
  ];
  if (space) {
    fields.push(
      { name: 'Space name', value: discordText(space.name || '', 160) || 'Not set', inline: true },
      { name: 'Handle', value: discordText(`@${space.handle}`, 164), inline: true },
      { name: 'Space ID', value: discordText(space.id, 256), inline: false },
    );
  }
  fields.push(
    { name: 'Hosting', value: mode, inline: true },
    {
      name: 'Plan',
      value: mode === 'self-hosted' ? 'All features included' : plan.plan,
      inline: true,
    },
    { name: 'Language', value: locale ?? 'Not provided', inline: true },
    { name: 'Site', value: discordText(sourceOrigin, 200), inline: false },
  );
  if (topic) fields.push({ name: 'Topic', value: REPORT_TOPICS[topic], inline: false });
  const body = {
    username: 'wya.im',
    allowed_mentions: { parse: [] },
    // SUPPRESS_EMBEDS would hide the formatted report itself. Embed text does
    // not create content-link previews, so do not set that flag here.
    embeds: [
      {
        title: 'New message',
        color: 0xa9d8fa,
        description: discordText(message, 3600),
        timestamp: new Date(now).toISOString(),
        fields,
        footer: { text: `Reference ${reference}` },
      },
    ],
  };

  const [owner, destination] = await Promise.all([digestKey(sender.userId), digestKey(webhook)]);
  // Hash the destination so a configured secret never appears in persisted counters.
  // Reports delivered to the same webhook share a budget.
  const quota = `report:${destination}`;
  // Attempts have a short cooldown; unsuccessful deliveries do not use the
  // account's hourly/daily allowance.
  await consumeLimit(db, `${quota}:attempt-minute:${owner}`, 6, 60_000, now);
  const release = await reserveLimits(
    db,
    [
      { key: `${quota}:hour:${owner}`, maximum: 20, windowMs: 3_600_000 },
      { key: `${quota}:day:${owner}`, maximum: 100, windowMs: 86_400_000 },
    ],
    now,
  );

  try {
    // Keep the shared attempt cap even during an upstream outage. If it is
    // full, the account's pending delivery reservation is refunded below.
    await consumeLimit(db, `${quota}:minute`, 30, 60_000, now);
    const response = await fetcher(`${webhook}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Workers supports manual redirects, not redirect: 'error'. Reject 3xx
      // below so the webhook secret or message can never follow a redirect.
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    // A failed cleanup must not report an already accepted message as failed.
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      const requestedDelay = Number(response.headers.get('Retry-After'));
      const retryAfter =
        Number.isFinite(requestedDelay) && requestedDelay > 0
          ? Math.min(86_400, requestedDelay)
          : 60;
      throw new RateLimitError(retryAfter, 'Messaging is busy. Please try again in a few minutes.');
    }
    if (!response.ok) throw new Error('Delivery failed');
  } catch (error) {
    await release();
    if (error instanceof AppError) throw error;
    // Network errors may contain the secret webhook URL. Never return or log them.
    throw new AppError('Could not confirm delivery. Please try again later.', 502);
  }
  return { sent: true as const, reference };
}
