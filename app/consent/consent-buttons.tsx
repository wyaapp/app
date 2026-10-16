'use client';
import {useState} from 'react';
import {authClient} from '@/lib/auth/client';
export default function ConsentButtons() {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function decide(accept:boolean) {
    setBusy(true);setError('');
    try {
      const result=await authClient.oauth2.consent({accept});
      if(result.error) {setError(result.error.message || 'Could not save your choice.');return;}
      if(result.data?.url) window.location.assign(result.data.url);
    } catch {setError('Could not connect. Try again.');} finally {setBusy(false);}
  }
  return <>{error && <p className="auth-error" role="alert">{error}</p>}<div className="auth-actions"><button className="button" disabled={busy} onClick={()=>decide(false)}>Cancel</button><button className="button button-dark" disabled={busy} onClick={()=>decide(true)}>{busy?'One moment…':'Allow access'}</button></div></>;
}
