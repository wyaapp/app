import { getChatGPTUser } from '../../chatgpt-auth';
import { checkHandle } from '@/lib/service';
import { AppError } from '@/lib/model';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const user=await getChatGPTUser();
  const headers={'Cache-Control':'private, no-store'};
  if(!user) return Response.json({error:'Sign in to continue.'},{status:401,headers});
  const params=new URL(request.url).searchParams;
  try {
    return Response.json(await checkHandle(user.userId,params.get('handle')??'',params.get('spaceId')||undefined),{headers});
  } catch(error) {
    if(error instanceof AppError) return Response.json({error:error.message},{status:error.status,headers});
    throw error;
  }
}
