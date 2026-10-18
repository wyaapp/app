// A deliberately small mailto surface: one recipient, subject and body only.
export type EmailFields = { address: string; subject: string; body: string };
const addressPattern =
  /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
export function parseEmailLink(value: string): EmailFields {
  let address = value.trim(),
    subject = '',
    body = '';
  if (/^mailto:/i.test(address)) {
    const url = new URL(address);
    if (url.hash || url.host)
      throw new Error('Use one email address, with only an optional subject and message.');
    address = decodeURIComponent(url.pathname);
    for (const key of url.searchParams.keys())
      if (!['subject', 'body'].includes(key) || url.searchParams.getAll(key).length !== 1)
        throw new Error('Only subject and body are supported in email links.');
    subject = url.searchParams.get('subject') ?? '';
    body = url.searchParams.get('body') ?? '';
  }
  if (
    address.length > 254 ||
    !addressPattern.test(address) ||
    address.startsWith('.') ||
    address.includes('..') ||
    address.split('@')[0].endsWith('.')
  )
    throw new Error('Enter a single valid email address.');
  if (subject.length > 120 || /[\x00-\x1f\x7f]/.test(subject))
    throw new Error('Use a subject up to 120 characters without line breaks.');
  if (body.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body))
    throw new Error('Use a message up to 500 characters.');
  return { address, subject, body };
}
export function emailLink(value: string, subject?: string, body?: string): string {
  const fields = parseEmailLink(value);
  if (subject !== undefined) fields.subject = subject;
  if (body !== undefined) fields.body = body;
  const query = new URLSearchParams();
  if (fields.subject) query.set('subject', fields.subject);
  if (fields.body) query.set('body', fields.body);
  const url = `mailto:${encodeURIComponent(fields.address).replace(/%40/gi, '@')}${query.size ? '?' + query.toString() : ''}`;
  // Validate optional overrides using the same rules as supplied mailto URLs.
  parseEmailLink(url);
  return url;
}
