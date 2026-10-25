import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getPublicProfile } from '@/lib/service';
import {
  createDiscordWidgetClient,
  DiscordWidgetError,
  publicDiscordGuild,
  publicFileDiscordGuild,
} from '@/lib/discord-widget';
import { AppError } from '@/lib/app-error';
import { consumeLimit, digestKey } from '@/lib/abuse-limits';
import { createSpaceFileService } from '@/lib/space-file-service';

export const dynamic = 'force-dynamic';
let client: ReturnType<typeof createDiscordWidgetClient> | undefined;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    let guildId: string;
    if (params.has('guildId')) {
      const user = await getChatGPTUser();
      if (!user) throw new AppError('Sign in to preview a Discord server.', 401);
      if (request.headers.get('sec-fetch-site') === 'cross-site')
        throw new AppError('Invalid request origin.', 403);
      await consumeLimit(env.DB!, `discord-preview:${await digestKey(user.userId)}`, 20, 60_000);
      guildId = params.get('guildId')!;
    } else {
      const handle = params.get('handle') ?? '',
        slug = params.get('slug') ?? '';
      if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(handle) || !/^[a-z0-9][a-z0-9._-]{0,39}$/.test(slug))
        throw new AppError('This widget is unavailable.', 404);
      const fileId = params.get('fileId');
      if (fileId !== null) {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fileId))
          throw new AppError('This widget is unavailable.', 404);
        const { file } = await createSpaceFileService(env.DB!).publicGet(handle, fileId);
        guildId = publicFileDiscordGuild(file!, slug);
      } else guildId = publicDiscordGuild(await getPublicProfile(handle), slug);
    }
    client ??= createDiscordWidgetClient({
      cache:
        'default' in caches ? (caches as CacheStorage & { default: Cache }).default : undefined,
      beforeRequest: async () => {
        await consumeLimit(env.DB!, 'discord-widget-second', 3, 1000);
        await consumeLimit(env.DB!, 'discord-widget-minute', 120, 60_000);
      },
    });
    return json(await client.get(guildId));
  } catch (error) {
    return json(
      {
        error:
          error instanceof AppError
            ? error.message
            : 'Could not load Discord right now. Try again shortly.',
        ...(error instanceof DiscordWidgetError ? { code: error.code } : {}),
      },
      error instanceof AppError ? error.status : 503,
    );
  }
}
