import { getAuth, isStandalone } from '@/lib/auth/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!isStandalone()) return new Response('Not found', { status: 404 });
  return getAuth().handler(request);
}
