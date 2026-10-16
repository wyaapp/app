import { getAuth, isStandalone } from '@/lib/auth/server';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!isStandalone()) return new Response('Not found', {status: 404});
  const response = await getAuth().handler(request);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export { handle as GET, handle as POST };
