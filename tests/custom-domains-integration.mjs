import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

/** Called by the loopback-only standalone harness. Never provisions a real domain. */
export async function checkCustomDomains({ db, origin, request, alice, bob }) {
  assert.equal(origin, 'http://127.0.0.1:8787');
  const { profile } = await (await request('/api/account', { headers: { Cookie: alice } })).json();
  assert.equal(profile.tabs, undefined);
  const publishedFile = profile.files.find((file) => file.published);
  assert.ok(publishedFile, 'Custom-domain fixture requires a published Markdown file');
  const endpoint = `/api/domains?spaceId=${encodeURIComponent(profile.id)}`;
  const hostname = `qa-${Date.now()}.example.com`;
  const change = (cookie, input, from = origin) =>
    request(endpoint, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: from, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  assert.equal((await request(endpoint)).status, 401);
  assert.equal((await request(endpoint, { headers: { Cookie: bob } })).status, 404);
  assert.equal(
    (await change(alice, { action: 'connect', hostname }, 'https://other.example')).status,
    403,
  );
  assert.equal((await change(bob, { action: 'connect', hostname })).status, 404);
  const settings = await change(alice, { action: 'connect', hostname });
  assert.equal(settings.status, 200, await settings.clone().text());
  assert.equal((await settings.json()).domain.status, 'ownership');
  if (process.env.WYA_CHECK_LIVE_DNS === 'true') {
    const checked = await change(alice, { action: 'check', hostname });
    assert.equal(checked.status, 200, await checked.clone().text());
    assert.equal((await checked.json()).domain.status, 'ownership');
  }
  assert.equal((await change(alice, { action: 'redirect', hostname, redirect: true })).status, 400);
  assert.equal((await change(alice, { action: 'remove', hostname })).status, 200);

  // Seed a provider response in local D1 to test the compiled request boundary.
  // API/DNS operations themselves are covered with injected fakes in unit tests.
  const current = await db.prepare('SELECT data FROM spaces WHERE id = ?').bind(profile.id).first();
  await db
    .prepare(
      `INSERT INTO space_domains (space_id, hostname, verification_token, verified_at,
    provider_id, hostname_status, ssl_status, dns_ready, checked_at, created_at, registration_id)
    VALUES (?, ?, 'local-fixture', ?, ?, 'active', 'active', 1, ?, ?, ?)`,
    )
    .bind(
      profile.id,
      hostname,
      Date.now(),
      `local-${profile.id}`,
      Date.now(),
      Date.now(),
      crypto.randomUUID(),
    )
    .run();
  const custom = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(origin + path, { headers: { Host: hostname, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }),
          ),
        );
      });
      req.on('error', reject);
      req.end();
    });
  try {
    for (const pageStyle of ['classic', 'desktop']) {
      await db
        .prepare('UPDATE spaces SET data = ? WHERE id = ?')
        .bind(JSON.stringify({ ...JSON.parse(current.data), pageStyle }), profile.id)
        .run();
      const page = await custom('/');
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.ok(html.includes('href="/github"'), `${pageStyle} short links use the custom root`);
      assert.ok(
        html.includes(`https://${hostname}`),
        `${pageStyle} canonical URL uses custom domain`,
      );
      assert.ok(!html.includes(`href="/${profile.handle}/github"`));
    }
    const rsc = await custom('/?_rsc', { RSC: '1' });
    assert.equal(rsc.status, 200);
    await rsc.text();
    const fileList = await custom(`/api/public-files?handle=${encodeURIComponent(profile.handle)}`);
    assert.equal(fileList.status, 200);
    const listing = await fileList.json();
    assert.equal(listing.pages, undefined);
    assert.ok(listing.files.some((file) => file.id === publishedFile.id));
    const fileResponse = await custom(
      `/api/public-files?handle=${encodeURIComponent(profile.handle)}&id=${publishedFile.id}`,
    );
    assert.equal(fileResponse.status, 200);
    const publicFile = (await fileResponse.json()).file;
    assert.equal(publicFile.version, 0);
    assert.ok(publicFile.content.includes('https://github.com/alexcastro'));
    assert.equal((await custom('/api/public-files?handle=someone-else')).status, 404);
    assert.equal(
      (await custom('/github')).headers.get('location'),
      'https://github.com/alexcastro',
    );
    assert.equal((await custom('/api/account', { Cookie: alice })).status, 404);
    assert.equal((await custom('/api/domains', { Cookie: alice })).status, 404);
    // Avatar aliases are canonical-host resources, not an escape from the
    // customer's single-space namespace or its public API allowlist.
    const canonicalAvatar = await request(`/${profile.handle}.png`);
    assert.equal(canonicalAvatar.status, 200);
    assert.equal(canonicalAvatar.headers.get('content-type'), 'image/png');
    await canonicalAvatar.arrayBuffer();
    assert.equal((await custom(`/${profile.handle}.png`)).status, 404);
    assert.equal((await custom(`/api/avatars/${profile.handle}`)).status, 404);
    assert.equal(
      (await custom('/dashboard/profile')).headers.get('location'),
      `${origin}/dashboard/profile`,
    );
    assert.equal((await custom('/someone/github')).status, 404);
    assert.equal((await request(`/${profile.handle}`)).status, 200);
    await change(alice, { action: 'redirect', hostname, redirect: true });
    const canonical = await request(`/${profile.handle}?tab=home&from=qr`);
    assert.equal(canonical.status, 307);
    assert.equal(canonical.headers.get('location'), `https://${hostname}/?from=qr`);
    assert.equal(
      (await request(`/${profile.handle}/github?from=qr`)).headers.get('location'),
      `https://${hostname}/github?from=qr`,
    );
    await db
      .prepare("UPDATE space_domains SET ssl_status = 'pending' WHERE space_id = ?")
      .bind(profile.id)
      .run();
    // This direct database change represents a mutation made by another isolate.
    // Its previous positive routing entry must disappear within the 15s TTL.
    const deadline = Date.now() + 16_000;
    let inactive;
    do {
      inactive = await custom('/robots.txt');
      if (inactive.status === 404) break;
      await delay(100);
    } while (Date.now() < deadline);
    assert.equal(inactive.status, 404, 'cached routing expires after a remote status change');
    assert.equal(
      (await request(`/${profile.handle}`)).status,
      200,
      'Wya remains available when TLS is pending',
    );
  } finally {
    await db.prepare('DELETE FROM space_domains WHERE space_id = ?').bind(profile.id).run();
    await db
      .prepare('UPDATE spaces SET data = ? WHERE id = ?')
      .bind(current.data, profile.id)
      .run();
  }
  console.log(
    'Custom-domain checks passed: scoped API, CSRF, both layouts, short links, RSC, canonical URLs, redirects and inactive-domain recovery.',
  );
}
