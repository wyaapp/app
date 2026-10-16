// Called by CI after migrations. Secrets flow through stdin, never command args or logs.
import {spawnSync} from 'node:child_process';
const names=['BETTER_AUTH_SECRET','RESEND_API_KEY'];
if(names.some(name=>!process.env[name])) throw new Error('Configure BETTER_AUTH_SECRET and RESEND_API_KEY before deploying email sign-in.');
if(process.env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters.');
const secrets=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk','--config','.cloudflare/wrangler.json'],{input:JSON.stringify(secrets),stdio:['pipe','inherit','inherit'],env:process.env});
if(result.error) throw result.error;
process.exitCode=result.status ?? 1;
