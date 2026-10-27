export function requiredQueueNames(config) {
  return [
    ...new Set(
      [
        ...(config.queues?.producers ?? []).map((producer) => producer.queue),
        ...(config.queues?.consumers ?? []).flatMap((consumer) => [
          consumer.queue,
          consumer.dead_letter_queue,
        ]),
      ].filter(Boolean),
    ),
  ].sort();
}

// Read-only preflight. Resource creation remains an explicit release step.
export async function checkCloudflareQueues(config, { apiToken, fetcher = fetch } = {}) {
  const names = requiredQueueNames(config);
  if (!names.length) return names;
  if (!/^[a-f0-9]{32}$/i.test(config.account_id ?? '') || !apiToken)
    throw new Error('Queue preflight requires the deployment account and API token.');
  if (names.some((name) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(name)))
    throw new Error('Queue preflight found an invalid queue name in the build.');

  const missing = [];
  for (const name of names) {
    let found = false;
    for (let page = 1; ; page++) {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/queues`,
      );
      url.searchParams.set('name', name);
      url.searchParams.set('page', String(page));
      let response;
      try {
        response = await fetcher(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiToken}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new Error(`Could not check Cloudflare queue ${name}. Check connectivity and retry.`);
      }
      if (!response.ok)
        throw new Error(
          `Could not check Cloudflare queue ${name} (HTTP ${response.status}). ` +
            'Check the deployment token and account access; no resources were created.',
        );
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`Invalid Cloudflare queue response for ${name}. Retry the preflight.`);
      }
      if (body?.success !== true || !Array.isArray(body.result))
        throw new Error(`Could not verify Cloudflare queue ${name}. Retry the preflight.`);
      if (body.result.some((queue) => queue?.queue_name === name)) {
        found = true;
        break;
      }
      const totalPages = body.result_info?.total_pages ?? 1;
      if (!Number.isSafeInteger(totalPages) || totalPages < 0 || totalPages > 1000)
        throw new Error(`Invalid Cloudflare queue pagination for ${name}.`);
      if (page >= totalPages) break;
    }
    if (!found) missing.push(name);
  }
  if (missing.length)
    throw new Error(
      `Missing Cloudflare queues in the deployment account: ${missing.join(', ')}.\n` +
        'After explicit infrastructure approval, create them using the deployment credentials:\n' +
        missing
          .map(
            (name) =>
              `npx --no-install wrangler queues create ${name} --config .cloudflare/wrangler.json`,
          )
          .join('\n') +
        '\nThen retry deployment. Automatic provisioning remains disabled.',
    );
  return names;
}
