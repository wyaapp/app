import type { DomainStatus } from './custom-domains.ts';

/** Explain observed checks without treating an unfinished check as a DNS error. */
export function domainConnectionView(domain: DomainStatus) {
  const active = domain.status === 'active';
  const ownership = active || domain.checks?.ownership === 'verified';
  const certificate = active || (ownership && domain.checks?.certificate === 'active');
  const completed = [ownership, certificate, active];
  const step = !ownership ? 0 : !certificate ? 1 : 2;
  if (domain.status === 'removing')
    return {
      state: 'waiting',
      badge: 'Disconnecting',
      completed,
      step,
      title: 'The domain is no longer serving this space',
      description:
        'Routing is disabled. We still need to finish removing the connection. Retry below; your Wya address keeps working.',
    };
  if (domain.status === 'suspended')
    return {
      state: 'warning',
      badge: 'Premium required',
      completed,
      step,
      title: 'Your domain connection is paused',
      description:
        'Premium is required to use this domain on hosted Wya. Your content and Wya address remain available.',
    };
  if (active)
    return {
      state: 'active',
      badge: 'Connected',
      completed,
      step,
      title: 'Your domain is ready',
      description:
        'Ownership, HTTPS and address routing are verified. Your space is available at this address.',
    };
  if (!domain.checks && domain.status === 'pending')
    return {
      state: 'waiting',
      badge: 'Connection pending',
      completed,
      step,
      title: 'Refresh the connection status',
      description: 'Run a check to see which setup steps are complete and what to do next.',
    };
  if (!ownership)
    return {
      state: 'warning',
      badge: 'Setup required',
      completed,
      step,
      title: domain.checkedAt > 0 ? 'Ownership is not verified yet' : 'Add your DNS records',
      description:
        domain.checkedAt > 0
          ? 'The last check could not confirm your ownership TXT record. Check its name and value below. If you just saved it, allow time for DNS to update, then check again.'
          : 'Add the records below at your domain provider, then check the connection. Verification starts when you run this check.',
    };
  if (!certificate)
    return {
      state: 'waiting',
      badge: 'Waiting for HTTPS',
      completed,
      step,
      title: 'Ownership verified. Secure connection next.',
      description:
        domain.records.length > 1
          ? 'Add any additional verification records shown below. HTTPS will activate after verification. We recheck automatically every few minutes.'
          : 'Your HTTPS certificate is not ready yet. We recheck automatically every few minutes. You can also check again below.',
    };
  return {
    state: 'waiting',
    badge: 'Connection pending',
    completed,
    step,
    title: 'HTTPS is ready. Check the address connection.',
    description:
      'We have not confirmed a current connection to Wya. Check the CNAME destination below, then run another check.',
  };
}
