import { APIError } from 'better-auth/api';

/** Bound limits cap both repeated mail to one address and the free-tier budget. */
export async function reserveEmail(db: D1Database, email: string, now = Date.now()) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  const recipient = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const date = new Date(now).toISOString();
  const limits: [string, number, number][] = [
    [`recipient-minute:${recipient}:${Math.floor(now / 60000)}`, 1, now + 120000],
    [`recipient-hour:${recipient}:${Math.floor(now / 3600000)}`, 5, now + 7200000],
    [`daily:${date.slice(0,10)}`, 90, now + 172800000],
    [`monthly:${date.slice(0,7)}`, 2500, now + 32 * 86400000],
  ];
  for (const [key, limit, expires] of limits) {
    const row = await db.prepare('INSERT INTO auth_mail_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(key, expires, limit).first();
    if (!row) throw new APIError('TOO_MANY_REQUESTS', { message: 'Please wait before requesting another code.' });
  }
  await db.prepare('DELETE FROM auth_mail_limits WHERE expires_at < ?').bind(now).run();
}

export async function sendLoginCode(db: D1Database, apiKey: string, email: string, code: string) {
  await reserveEmail(db, email);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      from: 'wya.im <hello@wya.im>', to: [email], subject: 'Your wya.im sign-in code',
      text: `Your wya.im sign-in code is ${code}.\n\nIt expires in 5 minutes. Enter it only on wya.im. If you didn’t request this, you can ignore this email.`,
      html: `<div style="background:#f9f6ef;padding:40px;font-family:Arial,sans-serif;color:#302039"><h1>wya.im</h1><p>Your little corner of the internet is waiting.</p><p>Enter this code to sign in:</p><p style="font-size:36px;letter-spacing:8px;font-weight:bold">${code}</p><p>Expires in 5 minutes. Enter it only on wya.im.</p><p style="font-size:12px">If you didn’t request this, you can ignore this email.</p></div>`,
    }),
  });
  if (!response.ok) {
    // Never log the message body, recipient, API key, or one-time code.
    console.error('Login email delivery failed', response.status);
    throw new APIError('SERVICE_UNAVAILABLE', { message: 'We could not send your code. Please try again shortly.' });
  }
}
