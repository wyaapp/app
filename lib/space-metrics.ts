import {AppError, type Profile} from './model.ts';
import {analyticsSpaceKey} from './analytics-key.ts';

export type MetricsRange=7|30;
export type MetricsData={days:MetricsRange;updatedAt:string;views:number;clicks:number;
  daily:{date:string;views:number;clicks:number}[];
  topItems:{id:string;label:string;kind:string;clicks:number}[]};
export type MetricsResult={configured:false}|({configured:true}&MetricsData);
type AggregateRow=[string,string,string,number];
type Config={host?:string;projectId?:string;readKey?:string;token?:string};
const TTL=5*60_000;

export function metricsWindow(days:MetricsRange,now:number) {
  const today=new Date(now);today.setUTCHours(0,0,0,0);
  return {start:new Date(today.getTime()-(days-1)*86400000).toISOString().slice(0,10),
    end:new Date(today.getTime()+86400000).toISOString().slice(0,10)};
}

export function metricsQuery(spaceKey:string,days:MetricsRange,now:number) {
  if(!/^[a-f0-9]{64}$/.test(spaceKey)||(days!==7&&days!==30))throw new AppError('Invalid metrics request.',400);
  const {start,end}=metricsWindow(days,now);
  return `SELECT toString(toDate(timestamp, 'UTC')), event, coalesce(toString(properties.wya_item_id), ''), count()
FROM events WHERE properties.wya_space_id = '${spaceKey}'
AND event IN ('$pageview', 'wya_item_click')
AND timestamp >= toDateTime('${start} 00:00:00', 'UTC') AND timestamp < toDateTime('${end} 00:00:00', 'UTC')
GROUP BY 1, 2, 3 LIMIT 5000`;
}

export function summarizeMetrics(rows:AggregateRow[],profile:Profile,days:MetricsRange,now:number):MetricsData {
  const {start}=metricsWindow(days,now);
  const daily=Array.from({length:days},(_,index)=>({date:new Date(Date.parse(start)+index*86400000).toISOString().slice(0,10),views:0,clicks:0}));
  const counts=new Map<string,number>();
  for(const [date,event,id,count] of rows) {
    const day=daily.find(day=>day.date===date);
    if(!day)continue;
    if(event==='$pageview')day.views+=count;
    else if(event==='wya_item_click'){day.clicks+=count;counts.set(id,(counts.get(id)??0)+count);}
  }
  const items=profile.links.flatMap(item=>item.collection?item.collection.items:[item]);
  const topItems=[...counts].map(([id,clicks])=>{
    const item=items.find(item=>(item.id??`legacy:${item.slug}`)===id);
    return {id,clicks,label:item?.label||'Removed item',kind:item?.kind??'link'};
  }).sort((a,b)=>b.clicks-a.clicks||a.id.localeCompare(b.id)).slice(0,10);
  return {days,updatedAt:new Date(now).toISOString(),views:daily.reduce((n,d)=>n+d.views,0),clicks:daily.reduce((n,d)=>n+d.clicks,0),daily,topItems};
}

function parseRows(value:unknown):AggregateRow[] {
  const results=(value as {results?:unknown})?.results;
  if(!Array.isArray(results)||results.length>=5000)throw new AppError('Metrics are temporarily unavailable.',503);
  return results.map(row=>{
    if(!Array.isArray(row)||row.length!==4||typeof row[0]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row[0])||
      !['$pageview','wya_item_click'].includes(row[1])||typeof row[2]!=='string'||row[2].length>200||
      !Number.isSafeInteger(row[3])||row[3]<0)throw new AppError('Metrics are temporarily unavailable.',503);
    return row as AggregateRow;
  });
}

/** Authorization always precedes cache access; queries never accept SQL or filters from the browser. */
export function createMetricsService(deps:{
  getOwnedSpace:(userId:string,spaceId:string)=>Promise<Profile|null>;
  config:()=>Config; beforeQuery:()=>Promise<void>; fetcher?:typeof fetch; now?:()=>number;
}) {
  const cache=new Map<string,{at:number;rows:AggregateRow[]}>();
  const pending=new Map<string,Promise<{at:number;rows:AggregateRow[]}>>();
  return async function getMetrics(userId:string,spaceId:string,days:MetricsRange):Promise<MetricsResult> {
    if(!spaceId||spaceId.length>200||(days!==7&&days!==30))throw new AppError('Invalid metrics request.',400);
    const profile=await deps.getOwnedSpace(userId,spaceId);
    if(!profile)throw new AppError('Space not found.',404);
    const config=deps.config();
    if(!config.token||!config.readKey||!config.projectId||!/^\d+$/.test(config.projectId))return {configured:false};
    const host=config.host==='https://eu.i.posthog.com'?'https://eu.posthog.com':config.host==='https://us.i.posthog.com'?'https://us.posthog.com':null;
    if(!host)return {configured:false};
    const now=(deps.now??Date.now)();
    const key=await analyticsSpaceKey(profile.id);
    const cacheKey=`${host}:${config.projectId}:${key}:${days}:${metricsWindow(days,now).end}`;
    let result=cache.get(cacheKey);
    if(!result||now-result.at>=TTL) {
      let request=pending.get(cacheKey);
      if(!request){
        if(pending.size>=50)throw new AppError('Metrics are busy. Try again shortly.',503);
        request=(async()=>{
          await deps.beforeQuery();
          const response=await (deps.fetcher??fetch)(`${host}/api/projects/${config.projectId}/query/`,{
            method:'POST',headers:{Authorization:`Bearer ${config.readKey}`,'Content-Type':'application/json'},
            body:JSON.stringify({query:{kind:'HogQLQuery',query:metricsQuery(key,days,now)}}),signal:AbortSignal.timeout(10_000),
          });
          if(!response.ok)throw new AppError(response.status===429?'Metrics are busy. Try again shortly.':'Metrics are temporarily unavailable.',503);
          const rows=parseRows(await response.json());
          const data={at:now,rows};
          if(cache.size>=100)cache.delete(cache.keys().next().value!);
          cache.set(cacheKey,data);return data;
        })();
        pending.set(cacheKey,request);
      }
      try {result=await request;} finally {if(pending.get(cacheKey)===request)pending.delete(cacheKey);}
    }
    return {configured:true,...summarizeMetrics(result.rows,profile,days,result.at)};
  };
}
