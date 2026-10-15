import { getPublicProfile } from '@/lib/service';
export const dynamic = 'force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{handle:string;slug:string}>}) {
  const {handle,slug} = await params;
  const p = await getPublicProfile(handle);
  const link = p?.links.find(l=>l.slug===slug.toLowerCase());
  if(!link) return new Response('This link is unavailable.',{status:404,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});
  return new Response(null,{status:302,headers:{Location:link.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
