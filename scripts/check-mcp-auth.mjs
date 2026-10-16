// Read-only production smoke check: no login, account creation, or valid token.
import assert from 'node:assert/strict';

const origin = 'https://wya.im';
const jwksResponse = await fetch(`${origin}/api/auth/jwks`, {signal: AbortSignal.timeout(15000)});
assert.equal(jwksResponse.status, 200, 'Public signing keys must be reachable');
const {keys} = await jwksResponse.json();
const key = keys?.[0];
assert.ok(key?.kid, 'The authorization server must publish a signing key');
const alg = key.alg || {OKP: 'EdDSA', RSA: 'RS256', EC: 'ES256'}[key.kty];
assert.ok(alg, 'Unsupported signing-key type');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const invalidToken = [
  encode({alg, kid: key.kid, typ: 'at+jwt'}),
  encode({iss: `${origin}/api/auth`, aud: `${origin}/mcp`, sub: 'invalid-probe', client_id: 'invalid-probe', scope: 'profile:read', exp: Math.floor(Date.now() / 1000) + 60}),
  Buffer.alloc(64).toString('base64url'),
].join('.');
const response = await fetch(`${origin}/mcp`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', Authorization: `Bearer ${invalidToken}`},
  body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'}),
  signal: AbortSignal.timeout(15000),
});
assert.equal(response.status, 401, 'MCP must reject an invalid signature without a signing-key fetch error');
assert.ok(response.headers.get('www-authenticate'), 'MCP must return an OAuth challenge');
console.log('Production MCP signing-key lookup works; invalid signatures are rejected with HTTP 401.');
