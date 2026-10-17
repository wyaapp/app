import {getChatGPTUser} from '../../chatgpt-auth';
import {searchCatalog} from '@/lib/catalog';
import {AppError} from '@/lib/model';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request) {
  const user=await getChatGPTUser();
  if(!user)return json({error:'Sign in to search the catalog.'},401);
  if(request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Invalid request origin.'},403);
  const params=new URL(request.url).searchParams;
  try{return json(await searchCatalog(user.userId,{type:params.get('type'),query:params.get('query')}));}
  catch(error){return json({error:error instanceof AppError?error.message:'Game search is temporarily unavailable.'},error instanceof AppError?error.status:503);}
}
