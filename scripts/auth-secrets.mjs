/** Shared release preflight and stdin-only Worker secret synchronization. */
export function authSecrets(environment) {
  const names = ['BETTER_AUTH_SECRET', 'RESEND_API_KEY', 'TURNSTILE_SECRET_KEY'];
  if (names.some((name) => !environment[name]))
    throw new Error(
      'Configure BETTER_AUTH_SECRET, RESEND_API_KEY and TURNSTILE_SECRET_KEY before deploying email sign-in.',
    );
  if (environment.BETTER_AUTH_SECRET.length < 32)
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters.');
  if (/^[123]x0{10}/.test(environment.TURNSTILE_SECRET_KEY))
    throw new Error('Turnstile testing keys cannot be deployed to production.');
  const catalogNames = ['IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET'];
  const billingNames = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const billingPrices = ['STRIPE_PRICE_USD_MONTHLY', 'STRIPE_PRICE_BRL_MONTHLY'];
  if ([...billingNames, ...billingPrices].some((name) => environment[name])) {
    if (
      environment.WYA_HOSTING_MODE !== 'hosted' ||
      [...billingNames, ...billingPrices].some((name) => !environment[name])
    )
      throw new Error(
        'Configure hosted mode, both Stripe secrets and both USD/BRL monthly prices together.',
      );
    if (
      !/^(?:sk|rk)_live_[A-Za-z0-9]+$/.test(environment.STRIPE_SECRET_KEY) ||
      !/^whsec_[A-Za-z0-9]+$/.test(environment.STRIPE_WEBHOOK_SECRET)
    )
      throw new Error(
        'Production billing requires live Stripe credentials and a webhook signing secret.',
      );
    names.push(...billingNames);
  }
  const domainNames = [
    'CUSTOM_DOMAINS_ZONE_ID',
    'CUSTOM_DOMAINS_TARGET',
    'CUSTOM_DOMAINS_API_TOKEN',
  ];
  if (domainNames.some((name) => environment[name])) {
    if (domainNames.some((name) => !environment[name]))
      throw new Error(
        'Configure CUSTOM_DOMAINS_ZONE_ID, CUSTOM_DOMAINS_TARGET and CUSTOM_DOMAINS_API_TOKEN together.',
      );
    names.push('CUSTOM_DOMAINS_API_TOKEN');
  }
  if (catalogNames.some((name) => environment[name])) {
    if (catalogNames.some((name) => !environment[name]))
      throw new Error(
        'Configure both IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to enable game search.',
      );
    names.push(...catalogNames);
  }
  if (environment.POSTHOG_READ_KEY) {
    if (!environment.POSTHOG_READ_KEY.startsWith('phx_'))
      throw new Error('POSTHOG_READ_KEY must be a server-only personal API key.');
    names.push('POSTHOG_READ_KEY');
  }
  for (const name of ['DISCORD_FEEDBACK_WEBHOOK', 'DISCORD_CONTACT_WEBHOOK']) {
    if (environment[name]) {
      if (
        environment[name] !== environment[name].trim() ||
        !/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(environment[name])
      )
        throw new Error(`${name} must be a Discord incoming webhook URL.`);
      names.push(name);
    }
  }
  return Object.fromEntries(names.map((name) => [name, environment[name]]));
}
