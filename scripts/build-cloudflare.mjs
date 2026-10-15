import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeCloudflareConfig } from './cloudflare-config.mjs';
await writeCloudflareConfig({checkOnly:process.argv.includes('--check')});
const result=spawnSync(process.execPath,[fileURLToPath(new URL('./run-framework.mjs',import.meta.url)),'build'],{
  stdio:'inherit',env:{...process.env,WYA_DEPLOY_TARGET:'cloudflare'},
});
if(result.error) throw result.error;
process.exitCode=result.status ?? 1;
