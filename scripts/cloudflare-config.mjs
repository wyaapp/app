import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const localDatabaseId = '00000000-0000-4000-8000-000000000000';
export function cloudflareConfig(environment, {checkOnly = false} = {}) {
  const databaseId = checkOnly ? localDatabaseId : environment.CLOUDFLARE_D1_DATABASE_ID;
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
  if(!databaseId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(databaseId) || (!checkOnly && databaseId === localDatabaseId)) {
    throw new Error('Set CLOUDFLARE_D1_DATABASE_ID to the UUID of the deployment database.');
  }
  if(!checkOnly && (!accountId || !/^[0-9a-f]{32}$/i.test(accountId))) {
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the target account ID.');
  }
  return {
    $schema:'../node_modules/wrangler/config-schema.json',
    name:'wya-im',
    main:'../deployment/worker.ts',
    compatibility_date:'2026-05-15',
    // OAuth token verification fetches this Worker's public /api/auth/jwks.
    // Route same-zone fetches through Cloudflare, not to an origin server.
    compatibility_flags:['nodejs_compat','global_fetch_strictly_public'],
    ...(checkOnly ? {} : {account_id:accountId}),
    // Domain attachment is managed in the Cloudflare dashboard. Empty routes
    // leave existing custom domains untouched; CI needs no DNS permissions.
    workers_dev:false,
    preview_urls:false,
    routes:[],
    vars:{WYA_AUTH_MODE:'email',WYA_ORIGIN:'https://wya.im'},
    observability:{enabled:true},
    r2_buckets:[{binding:'PICTURES',bucket_name:'wya-im-pictures'}],
    triggers:{crons:['17 * * * *']},
    d1_databases:[{binding:'DB',database_name:'wya-im',database_id:databaseId,migrations_dir:'../drizzle'}],
  };
}
export async function writeCloudflareConfig(options = {}) {
  const config = cloudflareConfig(process.env, options);
  const directory = fileURLToPath(new URL('../.cloudflare/',import.meta.url));
  await mkdir(directory,{recursive:true});
  const file = path.join(directory,'wrangler.json');
  await writeFile(file,JSON.stringify(config,null,2)+'\n');
  return file;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await writeCloudflareConfig({checkOnly:process.argv.includes('--check')});
  console.log('Cloudflare configuration prepared.');
}
