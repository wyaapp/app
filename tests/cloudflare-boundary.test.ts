import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareCloudflareRequest} from '../deployment/request-boundary.ts';
test('direct deployment strips forged Sites identity from public requests',()=>{
  const request=new Request('https://example.com/alex',{headers:{'oai-authenticated-user-id':'victim','oai-authenticated-user-email':'victim@example.com','accept':'text/html'}});
  const result=prepareCloudflareRequest(request);
  assert.ok(result instanceof Request);assert.equal(result.headers.get('oai-authenticated-user-id'),null);assert.equal(result.headers.get('oai-authenticated-user-email'),null);assert.equal(result.headers.get('accept'),'text/html');
});
test('direct deployment fails closed for account and MCP endpoints',()=>{
  for(const path of ['/dashboard','/api/account','/mcp','/mcp/','/signin-with-chatgpt','/callback']) {
    const result=prepareCloudflareRequest(new Request('https://example.com'+path));
    assert.ok(result instanceof Response);assert.equal(result.status,503);
  }
});
