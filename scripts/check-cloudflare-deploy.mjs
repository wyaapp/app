import { readFile } from 'node:fs/promises';
import { cloudflareConfig } from './cloudflare-config.mjs';
const desired=cloudflareConfig(process.env);
if(!process.env.CLOUDFLARE_API_TOKEN) throw new Error('Missing CLOUDFLARE_API_TOKEN GitHub Actions secret.');
const built=JSON.parse(await readFile(new URL('../dist/server/wrangler.json',import.meta.url),'utf8'));
if(built.name !== desired.name || built.account_id !== desired.account_id || built.d1_databases?.[0]?.database_id !== desired.d1_databases[0].database_id) throw new Error('Build does not target the configured Cloudflare account/database. Rebuild before deployment.');
if(built.workers_dev !== false || built.preview_urls !== false || built.routes?.length) throw new Error('Unexpected public exposure. Complete independent authentication before enabling public routes.');
console.log('Deployment target validated; public routes remain disabled.');
