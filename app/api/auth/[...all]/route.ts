import { boundedAuthRequest } from '@/lib/request-body';
import { AppError } from '@/lib/model';
import { getAuth, isStandalone } from '@/lib/auth/server';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!isStandalone()) return new Response('Not found', {status: 404});
  let bounded: Request;
  try { bounded = await boundedAuthRequest(request); }
  catch(error) {
    if(error instanceof AppError) return Response.json({message:error.message},{status:error.status,headers:{'Cache-Control':'private, no-store'}});
    throw error;
  }
  const response = await getAuth().handler(bounded);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export { handle as GET, handle as POST };
