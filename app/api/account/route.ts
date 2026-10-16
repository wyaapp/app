import { getChatGPTUser } from '../../chatgpt-auth';
import { getAccount, getHistory, listSpaces, mutate } from '@/lib/service';
import { AppError } from '@/lib/model';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request) {
  const user = await getChatGPTUser();
  if(!user) return json({error:'Sign in to continue.'},401);
  try {
    const spaceId = new URL(request.url).searchParams.get('spaceId') || undefined;
    const profile = await getAccount(user.userId,spaceId);
    return json({profile,spaces:await listSpaces(user.userId),history:profile?await getHistory(user.userId,profile.id):[]});
  } catch(error) {
    if(error instanceof AppError) return json({error:error.message},error.status);
    throw error;
  }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if(!user) return json({error:'Sign in to continue.'},401);
  if(request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({error:'Invalid request origin.'},403);
  if(!request.headers.get('content-type')?.includes('application/json')) return json({error:'Expected JSON.'},415);
  try {
    const text = await request.text();
    if(text.length > 16000) return json({error:'Request too large.'},413);
    const result = await mutate(user.userId,JSON.parse(text));
    return json({profile:result,history:await getHistory(user.userId,result.id),spaces:await listSpaces(user.userId)});
  } catch(error) {
    if(error instanceof AppError) return json({error:error.message},error.status);
    if(error instanceof SyntaxError) return json({error:'Invalid JSON.'},400);
    console.error('Account update failed',error);
    return json({error:'We could not save that change. Please try again.'},500);
  }
}
