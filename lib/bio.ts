// Bios remain plain text in storage. Only these explicit forms become links.
export const mentionPlatforms = {
  wya: {label:'Wya', prefix:'', base:'https://wya.im/'},
  github: {label:'GitHub', prefix:'github:', base:'https://github.com/'},
  instagram: {label:'Instagram', prefix:'instagram:', base:'https://www.instagram.com/'},
  linkedin: {label:'LinkedIn', prefix:'linkedin:', base:'https://www.linkedin.com/in/'},
  youtube: {label:'YouTube', prefix:'youtube:', base:'https://www.youtube.com/@'},
  tiktok: {label:'TikTok', prefix:'tiktok:', base:'https://www.tiktok.com/@'},
  x: {label:'X / Twitter', prefix:'x:', base:'https://x.com/'},
  bluesky: {label:'Bluesky', prefix:'bluesky:', base:'https://bsky.app/profile/'},
  telegram: {label:'Telegram', prefix:'telegram:', base:'https://t.me/'},
  twitch: {label:'Twitch', prefix:'twitch:', base:'https://www.twitch.tv/'},
} as const;
export type MentionPlatform = keyof typeof mentionPlatforms;
export type BioPart = {text:string; href?:string};

export function mentionText(platform:MentionPlatform, username:string):string {
  const handle=username.trim().replace(/^@/,'');
  const limit=platform==='wya'?39:100;
  const valid=platform==='wya'?/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i:/^[a-z0-9_][a-z0-9._-]*[a-z0-9_-]$|^[a-z0-9_]$/i;
  if(!valid.test(handle)||handle.length>limit) throw new Error(platform==='wya'?'Use 1–39 letters, numbers, dots, underscores, or hyphens, starting and ending with a letter or number.':'Enter a username using letters, numbers, dots, underscores, or hyphens. For other formats, paste the full profile URL into your bio.');
  return platform==='wya'?`@${handle}`:`${mentionPlatforms[platform].prefix}${handle}`;
}

function trimUrl(value:string) {
  let result=value.replace(/[.,!?;:]+$/g,'');
  let previous:string;
  do {
    previous=result;
    for(const [open,close] of [['(',')'],['[',']'],['{','}']]) {
      if(result.endsWith(close)&&result.split(close).length>result.split(open).length) result=result.slice(0,-1).replace(/[.,!?;:]+$/g,'');
    }
  } while(result!==previous);
  return result;
}

export function parseBio(bio:string):BioPart[] {
  const parts:BioPart[]=[];
  const candidates=/(?<![\p{L}\p{N}_@/:.+-])(?:https?:\/\/[^\s<>"']+|(?:github|instagram|linkedin|youtube|tiktok|x|bluesky|telegram|twitch):@?[\p{L}\p{N}_.-]+|@[\p{L}\p{N}_.-]+)/giu;
  let cursor=0;
  for(const match of bio.matchAll(candidates)) {
    const start=match.index;
    let text=match[0];
    let href:string;
    if(/^https?:\/\//i.test(text)) {
      text=trimUrl(text);
      try {
        const url=new URL(text);
        if(url.username||url.password||text.includes('\\')) continue;
        href=url.href;
      } catch {continue;}
    } else {
      // Do not link a valid-looking prefix of an invalid username or URL.
      if(/[\p{L}\p{N}_/@:+%-]/u.test(bio[start+text.length]??'')) continue;
      text=text.replace(/\.+$/,'');
      const colon=text.indexOf(':');
      const platform=(colon<0?'wya':text.slice(0,colon).toLowerCase()) as MentionPlatform;
      const handle=text.slice(colon<0?1:colon+1).replace(/^@/,'');
      try {mentionText(platform,handle);} catch {continue;}
      href=mentionPlatforms[platform].base+encodeURIComponent(platform==='wya'?handle.toLowerCase():handle);
    }
    if(start>cursor) parts.push({text:bio.slice(cursor,start)});
    parts.push({text,href});
    cursor=start+text.length;
  }
  if(cursor<bio.length) parts.push({text:bio.slice(cursor)});
  return parts;
}
