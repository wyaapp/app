import { z } from 'zod';
import { AppError } from './app-error.ts';
import { readBody } from './request-body.ts';
import {
  discordGuildId,
  DISCORD_CACHE_SECONDS,
  type DiscordWidgetData,
} from './discord-widget-types.ts';
import type { Profile } from './profile-types.ts';
import { findVisibleLink } from './profile-links.ts';
import { withoutHiddenTabs } from './profile-tabs.ts';

export class DiscordWidgetError extends AppError {
  code: 'disabled' | 'unavailable';
  constructor(code: 'disabled' | 'unavailable', message: string, status = 503) {
    super(message, status);
    this.code = code;
  }
}
const unavailable = () =>
  new DiscordWidgetError('unavailable', 'Could not load Discord right now. Try again shortly.');
const rawWidget = z.object({
  id: discordGuildId,
  name: z.string().min(1).max(100),
  instant_invite: z.string().max(2048).nullable().optional(),
  presence_count: z.number().int().min(0).max(100_000_000),
  channels: z
    .array(
      z.object({
        id: discordGuildId,
        name: z.string().max(100),
        position: z.number().int(),
      }),
    )
    .max(500),
  members: z
    .array(
      z.object({
        id: z.string().max(32),
        username: z.string().min(1).max(100),
        avatar_url: z.string().max(2048).optional(),
        status: z.enum(['online', 'idle', 'dnd', 'offline']).catch('offline'),
        channel_id: discordGuildId.optional(),
        game: z.object({ name: z.string().max(200) }).optional(),
      }),
    )
    .max(100),
});
function safeDiscordUrl(value: string | null | undefined, kind: 'invite' | 'avatar') {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return undefined;
    const allowed =
      kind === 'avatar'
        ? url.hostname === 'cdn.discordapp.com' &&
          /^\/widget-avatars\/[a-zA-Z0-9/_-]+$/.test(url.pathname)
        : (url.hostname === 'discord.com' && /^\/invite\/[a-zA-Z0-9_-]+$/.test(url.pathname)) ||
          (url.hostname === 'discord.gg' && /^\/[a-zA-Z0-9_-]+$/.test(url.pathname));
    return allowed ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function parseDiscordWidget(value: unknown, guildId: string): DiscordWidgetData {
  const parsed = rawWidget.safeParse(value);
  if (!parsed.success || parsed.data.id !== guildId) throw unavailable();
  const data = parsed.data;
  return {
    id: data.id,
    name: data.name,
    online: data.presence_count,
    inviteUrl: safeDiscordUrl(data.instant_invite, 'invite') ?? null,
    channels: [...data.channels]
      .sort((a, b) => a.position - b.position)
      .map(({ id, name }) => ({ id, name })),
    members: data.members.map((member) => ({
      id: member.id,
      name: member.username,
      status: member.status,
      avatarUrl: safeDiscordUrl(member.avatar_url, 'avatar'),
      channelId: member.channel_id,
      activity: member.game?.name,
    })),
  };
}

/** Public reads must check current visibility before accessing shared guild data. */
export function publicDiscordGuild(profile: Profile | null, slug: string) {
  const item = profile && findVisibleLink(withoutHiddenTabs(profile), slug);
  if (!item || item.kind !== 'discord' || !item.discord)
    throw new AppError('This widget is unavailable.', 404);
  return discordGuildId.parse(item.discord.guildId);
}

type Snapshot = { data: DiscordWidgetData; expires: number };
type CacheEntry = Snapshot | { error: DiscordWidgetError; expires: number };
type WidgetCache = {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<unknown>;
};
/** Bounded per-isolate cache + optional Cloudflare edge cache, with no stored presence history. */
export function createDiscordWidgetClient({
  fetcher = fetch,
  now = Date.now,
  cache,
  beforeRequest,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  cache?: WidgetCache;
  beforeRequest?: () => Promise<void>;
} = {}) {
  const memory = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<DiscordWidgetData>>();
  let rateLimitedUntil = 0;
  function remember(id: string, value: CacheEntry) {
    memory.delete(id);
    if (memory.size >= 128) memory.delete(memory.keys().next().value!);
    memory.set(id, value);
  }
  async function load(id: string): Promise<DiscordWidgetData> {
    const key = `https://wya.im/__cache/discord-widget/v1/${id}`;
    // Cache failures must not prevent a normal upstream request.
    try {
      const hit = await cache?.match(key);
      const snapshot = hit && ((await hit.json()) as Snapshot);
      if (
        snapshot &&
        snapshot.expires > now() &&
        snapshot.expires <= now() + DISCORD_CACHE_SECONDS * 1000
      ) {
        remember(id, snapshot);
        return snapshot.data;
      }
    } catch {
      /* The edge cache is best effort. */
    }
    if (now() < rateLimitedUntil) throw unavailable();
    let response: Response | undefined;
    try {
      await beforeRequest?.();
      response = await fetcher(`https://discord.com/api/v10/guilds/${id}/widget.json`, {
        headers: { Accept: 'application/json', 'User-Agent': 'DiscordBot (https://wya.im, 1.0)' },
        redirect: 'manual',
        signal: AbortSignal.timeout(7000),
      });
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        rateLimitedUntil =
          now() + Math.min(900, Math.max(30, Number.isFinite(retry) ? retry : 30)) * 1000;
        throw unavailable();
      }
      const value = JSON.parse(new TextDecoder().decode(await readBody(response, 256_000))) as {
        code?: number;
      };
      if (!response.ok) {
        if (value.code === 50004)
          throw new DiscordWidgetError(
            'disabled',
            'Enable Server Widget in Discord, then try again.',
            422,
          );
        throw unavailable();
      }
      const snapshot = {
        data: parseDiscordWidget(value, id),
        expires: now() + DISCORD_CACHE_SECONDS * 1000,
      };
      remember(id, snapshot);
      try {
        await cache?.put(
          key,
          Response.json(snapshot, {
            headers: { 'Cache-Control': `public, max-age=${DISCORD_CACHE_SECONDS}` },
          }),
        );
      } catch {
        /* The in-memory cache remains available. */
      }
      return snapshot.data;
    } catch (cause) {
      if (response?.body && !response.bodyUsed) await response.body.cancel();
      const error = cause instanceof DiscordWidgetError ? cause : unavailable();
      remember(id, { error, expires: now() + 30_000 });
      throw error;
    }
  }
  return {
    async get(input: string): Promise<DiscordWidgetData> {
      const parsed = discordGuildId.safeParse(input);
      if (!parsed.success) throw new AppError('Use a valid Discord server ID.');
      const id = parsed.data,
        saved = memory.get(id);
      if (saved && saved.expires > now()) {
        if ('error' in saved) throw saved.error;
        return saved.data;
      }
      if (pending.has(id)) return pending.get(id)!;
      if (pending.size >= 20) throw unavailable();
      const task = load(id).finally(() => pending.delete(id));
      pending.set(id, task);
      return task;
    },
  };
}
