import { env } from 'cloudflare:workers';
import { createGameCatalog } from './game-catalog';
import { consumeLimit, digestKey } from './abuse-limits';
import { AppError } from './app-error';

let catalog: ReturnType<typeof createGameCatalog> | undefined;
export async function searchCatalog(userId: string, input: unknown) {
  if (!env.DB) throw new AppError('Game search is unavailable.', 503);
  await consumeLimit(env.DB, `catalog-user:${await digestKey(userId)}`, 20, 60_000);
  catalog ??= createGameCatalog({
    clientId: env.IGDB_CLIENT_ID,
    clientSecret: env.IGDB_CLIENT_SECRET,
    beforeRequest: () => consumeLimit(env.DB!, 'catalog-igdb', 3, 1000),
  });
  return { items: await catalog.search(input) };
}
