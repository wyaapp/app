import { getPublicProfile } from '@/lib/service';
import { resolveLinkDestination } from '@/lib/link-redirects';
import { AppError } from '@/lib/model';
export const dynamic = 'force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{handle:string;slug:string}>}) {
  const {handle,slug} = await params;
  const p = await getPublicProfile(handle);
  const link = p?.links.find(l=>l.slug===slug.toLowerCase());
  if(!link) return new Response('This link is unavailable.',{status:404,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});
  try {
    const destination=await resolveLinkDestination(p!,link.slug,getPublicProfile,{origin:new URL(request.url).origin});
    return new Response(null,{status:302,headers:{Location:handle.toLowerCase() !== p!.handle ? `/${p!.handle}/${link.slug}` : destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch(error) {
    if(!(error instanceof AppError)) throw error;
    return new Response(error.message,{status:error.status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});
  }
}
