import assert from 'node:assert/strict';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function assertInitials(response) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('set-cookie'), null);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes.subarray(0, 8), pngSignature, 'fallback must be a real PNG, not SVG');
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  assert.ok(bytes.readUInt32BE(16) >= 64, 'initials image must have usable avatar resolution');
  assert.equal(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'initials image is square');
  assert.ok(response.headers.get('etag'));
  return { bytes, etag: response.headers.get('etag') };
}

/** Uses only the already running loopback Worker and its local D1/R2 fixtures. */
export async function checkProfileAvatars({
  origin,
  request,
  write,
  alice,
  suffix,
  pictured,
  pictureBytes,
  currentHandle,
  alias,
}) {
  assert.equal(origin, 'http://127.0.0.1:8787');
  for (const path of [`/missing-avatar-${suffix}.png`, `/api/avatars/missing-avatar-${suffix}`]) {
    const missing = await request(path);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('set-cookie'), null);
  }

  const avatarPath = `/${pictured.handle}.png`;
  const photo = await request(avatarPath);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), pictureBytes);
  assert.equal(photo.headers.get('set-cookie'), null);
  assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(photo.headers.get('cache-control').includes('public'));
  const photoTag = photo.headers.get('etag');
  assert.ok(photoTag);
  for (const path of [avatarPath, `/api/avatars/${pictured.handle}`, avatarPath.toUpperCase()]) {
    const head = await request(path, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'image/png');
    assert.equal(head.headers.get('etag'), photoTag);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const unchanged = await request(path, { headers: { 'If-None-Match': photoTag } });
    assert.equal(unchanged.status, 304);
    assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  }
  const forbiddenMethod = await request(avatarPath, { method: 'POST', body: 'not an upload' });
  assert.equal(forbiddenMethod.status, 405);
  assert.equal(forbiddenMethod.headers.get('allow'), 'GET, HEAD');

  const initials = await assertInitials(await request(`/${currentHandle}.png`));
  for (const handle of [alias, currentHandle.toUpperCase()]) {
    const variant = await assertInitials(await request(`/${handle}.png`));
    assert.deepEqual(
      variant.bytes,
      initials.bytes,
      'aliases and case variants resolve one profile',
    );
    assert.equal(variant.etag, initials.etag);
  }
  const noChange = await request(`/${currentHandle}.png`, {
    headers: { 'If-None-Match': initials.etag },
  });
  assert.equal(noChange.status, 304);

  // Dots were already allowed in handles. An existing literal .png profile keeps
  // its page, and the API form gives the other profile an unambiguous image URL.
  const collision = `avatar-${suffix}`;
  for (const [handle, name] of [
    [collision, 'Avatar Base'],
    [`${collision}.png`, 'Literal PNG Profile'],
  ]) {
    const created = await write(alice, { action: 'create_profile', handle, name });
    assert.equal(created.status, 200, await created.clone().text());
  }
  const literalPage = await request(`/${collision}.png`);
  assert.equal(literalPage.status, 200);
  assert.ok(literalPage.headers.get('content-type').includes('text/html'));
  assert.ok((await literalPage.text()).includes('Literal PNG Profile'));
  await assertInitials(await request(`/api/avatars/${collision}`));
  const literalInitials = await assertInitials(await request(`/api/avatars/${collision}.png`));
  const doubleSuffix = await assertInitials(await request(`/${collision}.png.png`));
  assert.deepEqual(doubleSuffix.bytes, literalInitials.bytes);

  console.log(
    'Profile avatar checks passed: public PNG fallback, picture bytes, aliases/case, HEAD, ETags, methods, missing profiles and literal .png profile collisions.',
  );
}
