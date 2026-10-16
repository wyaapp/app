// Shared by the dashboard, profile renderer, validation, and MCP discovery.
export const iconIds = ['globe','link','code','camera','briefcase','chat','video','music','headphones','mic','pen','book','mail','calendar','shopping-bag','heart','coffee','file','download','rocket','gamepad','users','star','palette'] as const;
export type LinkIconId = typeof iconIds[number];
export const platforms = ['website','github','instagram','linkedin','discord','youtube','tiktok','x','bluesky','threads','facebook','twitch','spotify','soundcloud','telegram','whatsapp','reddit','pinterest','dribbble','behance','medium','substack','portfolio','blog','newsletter','shop','booking','resume','support','custom'] as const;
export type Platform = typeof platforms[number];
type Preset = {label:string; icon:LinkIconId; group:'Social'|'Music & video'|'Work & everyday'; placeholder:string};
export const linkPresets: Record<Platform, Preset> = {
  website:{label:'Website',icon:'globe',group:'Work & everyday',placeholder:'https://your-site.com'},
  github:{label:'GitHub',icon:'code',group:'Social',placeholder:'@yourname or https://github.com/yourname'},
  instagram:{label:'Instagram',icon:'camera',group:'Social',placeholder:'@yourname or https://instagram.com/yourname'},
  linkedin:{label:'LinkedIn',icon:'briefcase',group:'Social',placeholder:'https://www.linkedin.com/in/yourname'},
  discord:{label:'Discord',icon:'chat',group:'Social',placeholder:'https://discord.gg/your-invite'},
  youtube:{label:'YouTube',icon:'video',group:'Music & video',placeholder:'https://www.youtube.com/@yourname'},
  tiktok:{label:'TikTok',icon:'video',group:'Music & video',placeholder:'https://www.tiktok.com/@yourname'},
  x:{label:'X / Twitter',icon:'chat',group:'Social',placeholder:'https://x.com/yourname'},
  bluesky:{label:'Bluesky',icon:'chat',group:'Social',placeholder:'https://bsky.app/profile/yourname.bsky.social'},
  threads:{label:'Threads',icon:'chat',group:'Social',placeholder:'Paste your full profile URL'},
  facebook:{label:'Facebook',icon:'users',group:'Social',placeholder:'https://www.facebook.com/yourname'},
  twitch:{label:'Twitch',icon:'gamepad',group:'Music & video',placeholder:'https://www.twitch.tv/yourname'},
  spotify:{label:'Spotify',icon:'headphones',group:'Music & video',placeholder:'Paste your Spotify share URL'},
  soundcloud:{label:'SoundCloud',icon:'music',group:'Music & video',placeholder:'https://soundcloud.com/yourname'},
  telegram:{label:'Telegram',icon:'chat',group:'Social',placeholder:'https://t.me/yourname'},
  whatsapp:{label:'WhatsApp',icon:'chat',group:'Social',placeholder:'Paste your WhatsApp share URL'},
  reddit:{label:'Reddit',icon:'users',group:'Social',placeholder:'https://www.reddit.com/user/yourname'},
  pinterest:{label:'Pinterest',icon:'palette',group:'Social',placeholder:'https://www.pinterest.com/yourname'},
  dribbble:{label:'Dribbble',icon:'palette',group:'Work & everyday',placeholder:'https://dribbble.com/yourname'},
  behance:{label:'Behance',icon:'palette',group:'Work & everyday',placeholder:'https://www.behance.net/yourname'},
  medium:{label:'Medium',icon:'pen',group:'Work & everyday',placeholder:'https://medium.com/@yourname'},
  substack:{label:'Substack',icon:'mail',group:'Work & everyday',placeholder:'https://yourname.substack.com'},
  portfolio:{label:'Portfolio',icon:'briefcase',group:'Work & everyday',placeholder:'https://your-site.com/work'},
  blog:{label:'Blog',icon:'book',group:'Work & everyday',placeholder:'https://your-site.com/blog'},
  newsletter:{label:'Newsletter',icon:'mail',group:'Work & everyday',placeholder:'Paste your newsletter signup URL'},
  shop:{label:'Shop',icon:'shopping-bag',group:'Work & everyday',placeholder:'Paste your shop URL'},
  booking:{label:'Book a call',icon:'calendar',group:'Work & everyday',placeholder:'Paste your booking page URL'},
  resume:{label:'Résumé / CV',icon:'file',group:'Work & everyday',placeholder:'Paste a public document URL'},
  support:{label:'Support my work',icon:'coffee',group:'Work & everyday',placeholder:'Paste your support or donation page URL'},
  custom:{label:'Custom link',icon:'link',group:'Work & everyday',placeholder:'https://…'},
};
