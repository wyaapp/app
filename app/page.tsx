import { ArrowRight, ArrowUpRight, Check, Sparkles } from 'lucide-react';
import { Brand } from './components/brand';
import { ProfileCard } from './components/profile-card';
import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
import type { Profile } from '@/lib/model';
export const dynamic = 'force-dynamic';
const sample: Profile = {id:'example',aliases:[],handle:'alexcastro',name:'Alex Castro',bio:'Building things. Sharing ideas. Probably online.',theme:'lilac',version:1,updatedAt:'',links:[
  {slug:'website',label:'My little corner of the web',url:'',platform:'website',visible:true},
  {slug:'github',label:'Things I’m building',url:'',platform:'github',visible:true},
  {slug:'instagram',label:'Life outside the tabs',url:'',platform:'instagram',visible:true},
  {slug:'discord',label:'Come hang out',url:'',platform:'discord',visible:true},
]};
export default async function Home(){
  const user = await getChatGPTUser();
  const start = user ? '/dashboard' : chatGPTSignInPath('/dashboard');
  return <div className="site-shell">
    <header className="site-header"><Brand/><nav><a href="#how-it-works" className="quiet-nav">How it works</a><a href={start} target="_top" className="button button-small button-dark">{user ? 'Your space' : 'Get your wya'}<ArrowUpRight size={16}/></a></nav></header>
    <main>
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span className="status-dot"/> YOUR INTERNET HAS AN ADDRESS.</div>
          <h1>Where<br/>you <span className="at-word">at<span className="question">?</span></span></h1>
          <p className="hero-description">All your links. One very you address.<br/>Update it just by talking to ChatGPT.</p>
          <a href={start} target="_top" className="button button-dark hero-button">Claim your name <ArrowUpRight size={19}/></a>
          <p className="small-note">A little URL. A lot of you.</p>
          <div className="address-example"><span>↳</span> wya.im/<strong>you</strong></div>
        </div>
        <div className="hero-art"><div className="orbit-word">FOUND YOU ↘</div><div className="sample-label">EXAMPLE PROFILE</div><ProfileCard profile={sample} preview/>
          <div className="conversation-card"><div className="conversation-icon"><Sparkles size={20}/></div><div><p>“Add my GitHub to my wya.”</p><span><Check size={13}/> Your space, updated through ChatGPT</span></div></div>
        </div>
      </section>
      <section className="link-strip"><span>ONE HOME FOR</span><span>your work <ArrowUpRight size={16}/></span><span>your side quests <ArrowUpRight size={16}/></span><span>your community <ArrowUpRight size={16}/></span><span>whatever’s next <ArrowUpRight size={16}/></span></section>
      <section className="how-section" id="how-it-works"><div><div className="eyebrow">LESS UPKEEP. MORE YOU.</div><h2>Less clicking.<br/>More living.</h2><p>Keep your links in one place. Change them in the same conversation where your next idea starts.</p></div><div className="steps"><article><span>01</span><div><h3>Claim your name</h3><p>Make wya.im/you your address. Short enough to say out loud.</p></div></article><article><span>02</span><div><h3>Bring your world together</h3><p>Add usernames, projects, and places. Every link gets its own memorable address.</p></div></article><article><span>03</span><div><h3>Just say what’s changed</h3><p>Connect wya.im in ChatGPT to update your bio, add a link, or move things around.</p></div></article></div></section>
      <section className="closing"><h2>See you on the internet.</h2><a className="button button-dark" href={start} target="_top">Get your wya <ArrowRight size={18}/></a></section>
    </main>
    <footer><Brand/><span>A home for everywhere you are.</span><span>where you at? im…</span></footer>
  </div>
}
