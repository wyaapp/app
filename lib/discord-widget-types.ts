import { z } from 'zod';

export const discordGuildId = z
  .string()
  .regex(/^[1-9][0-9]{16,19}$/, 'Use a valid Discord server ID.');
export const discordConfigSchema = z.object({ guildId: discordGuildId }).strict();
export type DiscordConfig = z.infer<typeof discordConfigSchema>;
export const DISCORD_CACHE_SECONDS = 15 * 60;

/** Accept identifiers, never arbitrary upstream URLs. */
export function parseDiscordSource(input: string): string | null {
  const value = input.trim();
  if (discordGuildId.safeParse(value).success) return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'discord.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      return null;
    const match = /^\/api(?:\/v[0-9]+)?\/guilds\/([0-9]+)\/widget\.json$/.exec(url.pathname);
    return match && discordGuildId.safeParse(match[1]).success ? match[1] : null;
  } catch {
    return null;
  }
}

export type DiscordMember = {
  id: string;
  name: string;
  avatarUrl?: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  channelId?: string;
  activity?: string;
};
export type DiscordWidgetData = {
  id: string;
  name: string;
  inviteUrl: string | null;
  online: number;
  channels: { id: string; name: string }[];
  members: DiscordMember[];
};
