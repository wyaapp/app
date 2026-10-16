import { getChatGPTUser } from '../../chatgpt-auth';
import { pictures } from '@/lib/pictures';
import { AppError } from '@/lib/model';
export const dynamic='force-dynamic';
async function change(request:Request) {
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
  const user=await getChatGPTUser();
  if(!user) return json({error:'Sign in to continue.'},401);
  if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site') return json({error:'Invalid request origin.'},403);
  try {
    const params=new URL(request.url).searchParams;
    const spaceId=params.get('spaceId') || '';
    const version=Number(params.get('expectedVersion'));
    const service=pictures();
    const profile=request.method==='DELETE' ? await service.remove(user.userId,spaceId,version) : await service.upload(user.userId,spaceId,version,request);
    return json({profile});
  } catch(error) {
    if(error instanceof AppError) return json({error:error.message},error.status);
    console.error('Picture update failed',error);
    return json({error:'Could not save your picture. Please try again.'},500);
  }
}
export const PUT=change;
export const DELETE=change;
