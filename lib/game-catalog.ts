import {z} from 'zod';
import {AppError} from './model.ts';
import type {CatalogItem} from './catalog-types.ts';

export const catalogSearchSchema=z.object({type:z.literal('game'),query:z.string().trim().min(2).max(80)}).strict();
const gamesSchema=z.array(z.object({id:z.number().int().positive(),name:z.string().min(1).max(500),slug:z.string().regex(/^[a-z0-9-]+$/).max(200),first_release_date:z.number().optional(),cover:z.object({image_id:z.string().regex(/^[a-zA-Z0-9_]+$/).max(100)}).optional(),platforms:z.array(z.object({name:z.string().max(100)})).max(100).optional()})).max(12);
type Options={clientId?:string;clientSecret?:string;fetcher?:typeof fetch;now?:()=>number;beforeRequest?:()=>Promise<void>};

/** Fixed upstreams only. No arbitrary URL fetches and no credentials in results. */
export function createGameCatalog({clientId,clientSecret,fetcher=fetch,now=Date.now,beforeRequest=async()=>{}}:Options) {
  let token: {value:string;expires:number}|undefined;
  let tokenRequest:Promise<string>|undefined;
  const cache=new Map<string,{expires:number;items:CatalogItem[]}>();
  const pending=new Map<string,Promise<CatalogItem[]>>();
  async function accessToken() {
    if(token&&token.expires>now())return token.value;
    if(tokenRequest)return tokenRequest;
    tokenRequest=(async()=>{
      const response=await fetcher('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId!,client_secret:clientSecret!,grant_type:'client_credentials'}),signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw new AppError('Game search could not authenticate with its catalog. Please try again later.',503);
      const data=z.object({access_token:z.string().min(1),expires_in:z.number().positive()}).parse(await response.json());
      token={value:data.access_token,expires:now()+Math.max(0,data.expires_in-60)*1000};
      return token.value;
    })();
    try{return await tokenRequest;}finally{tokenRequest=undefined;}
  }
  async function queryGames(query:string):Promise<CatalogItem[]> {
    // Escape APICalypse's string literal; never interpolate raw query syntax.
    const escaped=query.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\x00-\x1f\x7f]/g,' ');
    for(let attempt=0;attempt<2;attempt++) {
      const bearer=await accessToken();
      await beforeRequest();
      const response=await fetcher('https://api.igdb.com/v4/games',{method:'POST',headers:{'Client-ID':clientId!,Authorization:`Bearer ${bearer}`,'Content-Type':'text/plain'},body:`search "${escaped}"; fields name,slug,cover.image_id,first_release_date,platforms.name; limit 12;`,signal:AbortSignal.timeout(6000)});
      if(response.status===401&&attempt===0){token=undefined;continue;}
      if(response.status===429)throw new AppError('The game catalog is busy. Please try again shortly.',429);
      if(!response.ok)throw new AppError('Game search is temporarily unavailable. Please try again.',503);
      return gamesSchema.parse(await response.json()).map(game=>({type:'game',title:game.name.slice(0,60),source:{provider:'igdb',id:game.id,slug:game.slug},platforms:(game.platforms??[]).slice(0,4).map(platform=>platform.name),...(game.cover?{coverUrl:`https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`}:{}),...(game.first_release_date?{year:new Date(game.first_release_date*1000).getUTCFullYear()}: {})}));
    }
    throw new AppError('Game search is temporarily unavailable.',503);
  }
  return {async search(input:unknown):Promise<CatalogItem[]> {
    const parsed=catalogSearchSchema.safeParse(input);
    if(!parsed.success)throw new AppError('Search with 2–80 characters and a supported interest type.');
    if(!clientId||!clientSecret)throw new AppError('Game search is not configured yet. The site owner needs to connect IGDB.',503);
    const query=parsed.data.query,key=query.toLowerCase();
    const saved=cache.get(key);
    if(saved&&saved.expires>now())return structuredClone(saved.items);
    let request=pending.get(key);
    if(!request) {
      request=queryGames(query).then(items=>{
        if(cache.size>=100)cache.delete(cache.keys().next().value!);
        cache.set(key,{expires:now()+600_000,items});return items;
      });
      pending.set(key,request);
    }
    try{return structuredClone(await request);}catch(error){
      if(error instanceof AppError)throw error;
      throw new AppError('Game search is temporarily unavailable. Please try again.',503);
    }finally{pending.delete(key);}
  }};
}
