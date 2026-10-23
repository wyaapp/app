import { env } from 'cloudflare:workers';
import { createSpaceFileService } from '@/lib/space-file-service';
import { AppError } from '@/lib/app-error';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  try {
    const params = new URL(request.url).searchParams;
    const handle = params.get('handle') ?? '';
    const id = params.get('id') || undefined;
    if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(handle) || (id && !/^[a-f0-9-]{36}$/.test(id)))
      throw new AppError('File not found.', 404);
    return json(await createSpaceFileService(env.DB!).publicGet(handle, id));
  } catch (error) {
    return json(
      {
        error:
          error instanceof AppError ? error.message : 'Could not load files. Please try again.',
      },
      error instanceof AppError ? error.status : 503,
    );
  }
}
