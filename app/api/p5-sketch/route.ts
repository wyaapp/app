import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { AppError } from '@/lib/app-error';
import { consumeLimit, digestKey } from '@/lib/abuse-limits';
import { createP5ImportClient } from '@/lib/p5-import-server';

export const dynamic = 'force-dynamic';
let client: ReturnType<typeof createP5ImportClient> | undefined;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new AppError('Sign in to import a p5.js editor sketch.', 401);
    if (request.headers.get('sec-fetch-site') === 'cross-site')
      throw new AppError('Invalid request origin.', 403);
    await consumeLimit(env.DB!, `p5-import:${await digestKey(user.userId)}`, 20, 60_000);
    client ??= createP5ImportClient({
      beforeRequest: async () => {
        await consumeLimit(env.DB!, 'p5-import-global', 120, 60_000);
      },
    });
    return json(await client.get(new URL(request.url).searchParams.get('url') ?? ''));
  } catch (error) {
    return json(
      {
        error:
          error instanceof AppError
            ? error.message
            : 'Could not import this sketch. Try again shortly.',
      },
      error instanceof AppError ? error.status : 503,
    );
  }
}
