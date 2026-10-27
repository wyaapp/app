'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowsClockwise';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { GlobeIcon } from '@phosphor-icons/react/dist/ssr/Globe';
import { LinkBreakIcon } from '@phosphor-icons/react/dist/ssr/LinkBreak';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/ssr/WarningCircle';
import { useTranslation } from '../components/language-provider';
import type { DomainRecord, DomainSettings as Settings } from '@/lib/custom-domains';
import { domainConnectionView } from '@/lib/domain-connection-view';
import type { Profile } from '@/lib/profile-types';
import type { AccountPlanSnapshot } from '@/lib/plans';

type DomainAction = {
  action: 'connect' | 'check' | 'redirect' | 'remove';
  hostname?: string;
  redirect?: boolean;
};

export function DomainSettings({
  profile,
  onChanged,
  plan,
  onExplorePremium,
}: {
  profile: Profile;
  onChanged: (domain: Profile['publicDomain']) => void;
  plan: AccountPlanSnapshot;
  onExplorePremium: () => void;
}) {
  const { t, locale } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pendingAction, setPendingAction] = useState<DomainAction['action'] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [feedbackAction, setFeedbackAction] = useState<DomainAction['action'] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const endpoint = `/api/domains?spaceId=${encodeURIComponent(profile.id)}`;
  const busy = pendingAction !== null;
  const domain = settings?.domain;
  const active = domain?.status === 'active';
  const disconnecting = domain?.status === 'removing';
  const suspended = domain?.status === 'suspended';
  const view = domain ? domainConnectionView(domain) : null;
  const progressKnown = active || Boolean(domain?.checks) || domain?.status === 'ownership';

  function updateSettings(data: Settings) {
    setSettings(data);
    onChanged(
      data.domain?.status === 'active'
        ? { hostname: data.domain.hostname, redirect: data.domain.redirect }
        : undefined,
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as Settings & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load domain settings.');
        setSettings(data);
        setError('');
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load domain settings.');
      });
    return () => controller.abort();
  }, [endpoint, attempt, plan.premiumUntil, plan.hostingMode]);

  // Read the background maintenance result without triggering extra DNS checks.
  useEffect(() => {
    if (busy || !['pending', 'removing'].includes(domain?.status ?? '')) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as Settings;
        if (controller.signal.aborted) return;
        setSettings(data);
        onChanged(
          data.domain?.status === 'active'
            ? { hostname: data.domain.hostname, redirect: data.domain.redirect }
            : undefined,
        );
      } catch {
        /* The manual check remains available if a background read fails. */
      }
    }, 30_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [endpoint, domain?.status, busy, onChanged]);

  async function change(input: DomainAction) {
    if (busy) return;
    setPendingAction(input.action);
    setFeedbackAction(input.action);
    setError('');
    setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as Settings & { error?: string };
      if (!response.ok)
        throw new Error(data.error || 'Could not update domain settings. Please try again.');
      updateSettings(data);
      setRemoving(false);
      setMessage(
        input.action === 'remove'
          ? 'Domain disconnected. Your content and Wya address are unchanged.'
          : input.action === 'redirect'
            ? 'Address preference saved.'
            : input.action === 'check'
              ? 'Check complete.'
              : 'Domain added. Now add the DNS records below.',
      );
    } catch (cause) {
      // Routing may already be disabled even if provider cleanup failed.
      try {
        const latest = await fetch(endpoint);
        if (latest.ok) updateSettings((await latest.json()) as Settings);
      } catch {
        /* Keep the original action error. */
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update domain settings. Please try again.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  const notices = (
    <>
      {error && (
        <div className="domain-notice is-error" role="alert">
          <WarningCircleIcon size={20} aria-hidden="true" />
          <div>
            <strong>{t('Action could not be completed')}</strong>
            <p>{t(error)}</p>
          </div>
        </div>
      )}
      <p className="domain-action-feedback" role="status" aria-live="polite">
        {pendingAction === 'check'
          ? t('Checking DNS and HTTPS…')
          : pendingAction === 'remove'
            ? t('Disconnecting domain…')
            : pendingAction === 'redirect'
              ? t('Saving address preference…')
              : pendingAction === 'connect'
                ? t('Adding domain…')
                : message
                  ? t(message)
                  : ''}
      </p>
    </>
  );

  return (
    <section className="window-section domain-settings" aria-labelledby="domain-heading">
      {!domain && (
        <header className="domain-intro">
          <h2 id="domain-heading">{t('Connect your domain')}</h2>
          <p>{t('Use your own address for this space. Your Wya address stays available.')}</p>
        </header>
      )}
      {!settings && !error && <p role="status">{t('Loading…')}</p>}
      {!domain && notices}
      {!settings && error && (
        <button
          type="button"
          className="button button-small"
          onClick={() => setAttempt(attempt + 1)}
        >
          {t('Try again')}
        </button>
      )}
      {settings && !settings.available && (
        <div className="domain-notice" role="status">
          <WarningCircleIcon size={20} aria-hidden="true" />
          <div>
            <strong>{t('Domain connections are unavailable')}</strong>
            <p>{t('Custom domains are not available yet. Your Wya address works as usual.')}</p>
          </div>
        </div>
      )}
      {settings && !settings.entitled && !domain && (
        <div className="domain-empty">
          <p>
            {t(
              'Custom domains are included with hosted Premium. Your Wya address stays available on Free.',
            )}
          </p>
          <button type="button" className="button button-primary" onClick={onExplorePremium}>
            {t('Explore Premium')}
          </button>
        </div>
      )}
      {settings?.available && settings.entitled && !domain && (
        <form
          className="domain-connect"
          onSubmit={(event) => {
            event.preventDefault();
            void change({
              action: 'connect',
              hostname: String(new FormData(event.currentTarget).get('hostname') ?? ''),
            });
          }}
        >
          <label>
            {t('Your domain')}
            <input
              name="hostname"
              placeholder="example.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={253}
              disabled={busy}
              aria-describedby="domain-format"
            />
          </label>
          <p id="domain-format" className="field-description">
            {t(
              'Enter only the address, without https://. You will need access to its DNS settings.',
            )}
          </p>
          <button className="button button-primary" disabled={busy}>
            {pendingAction === 'connect' ? t('Adding domain…') : t('Continue to DNS setup')}
            <ArrowUpRightIcon size={16} aria-hidden="true" />
          </button>
        </form>
      )}
      {domain && view && (
        <>
          <header className="domain-summary">
            <div className="domain-identity">
              <GlobeIcon size={28} weight="duotone" aria-hidden="true" />
              <div>
                <h2 id="domain-heading">{domain.hostname}</h2>
                <p>{t('For space @{handle}', { handle: profile.handle })}</p>
              </div>
            </div>
            <span className={`domain-status is-${view.state}`}>{t(view.badge)}</span>
          </header>

          <section
            className="domain-connection window-section-divider"
            aria-labelledby="domain-connection-heading"
          >
            {!suspended && !disconnecting && progressKnown && (
              <ol className="domain-progress" aria-label={t('Connection progress')}>
                {['Verify ownership', 'Enable HTTPS', 'Connect address'].map((label, index) => {
                  const done = view.completed[index];
                  const current = !active && view.step === index;
                  return (
                    <li
                      key={label}
                      className={done ? 'is-complete' : current ? 'is-current' : ''}
                      aria-current={current ? 'step' : undefined}
                    >
                      <span className="domain-step-number" aria-hidden="true">
                        {done ? <CheckIcon size={16} weight="bold" /> : index + 1}
                      </span>
                      <span>
                        <strong>{t(label)}</strong>
                        <small>{t(done ? 'Complete' : current ? 'Current step' : 'Up next')}</small>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="domain-current-step">
              <p className="domain-eyebrow">
                {active || !progressKnown
                  ? t('Connection status')
                  : suspended || disconnecting
                    ? t('Action required')
                    : t('Step {step} of 3', { step: view.step + 1 })}
              </p>
              <h3 id="domain-connection-heading">{t(view.title)}</h3>
              <p>{t(view.description)}</p>
            </div>
            {(disconnecting || (feedbackAction !== 'redirect' && feedbackAction !== 'remove')) &&
              notices}
            <div className="domain-actions">
              {active && (
                <a
                  className="button button-primary button-small"
                  href={`https://${domain.hostname}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('Open website')}
                  <ArrowUpRightIcon size={16} aria-hidden="true" />
                </a>
              )}
              {suspended && (
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={onExplorePremium}
                >
                  {t('Explore Premium')}
                </button>
              )}
              {disconnecting ? (
                <button
                  type="button"
                  className="button button-small"
                  disabled={busy || !settings?.available}
                  onClick={() => void change({ action: 'remove', hostname: domain.hostname })}
                >
                  {pendingAction === 'remove'
                    ? t('Disconnecting domain…')
                    : t('Retry disconnection')}
                </button>
              ) : (
                !suspended && (
                  <button
                    type="button"
                    className={`button button-small ${active ? '' : 'button-primary'}`}
                    disabled={busy || !settings?.available || !settings?.entitled}
                    onClick={() => void change({ action: 'check', hostname: domain.hostname })}
                  >
                    <ArrowsClockwiseIcon
                      size={16}
                      className={pendingAction === 'check' ? 'is-spinning' : ''}
                      aria-hidden="true"
                    />
                    {pendingAction === 'check' ? t('Checking…') : t('Check connection')}
                  </button>
                )
              )}
              {!disconnecting && (
                <p className="domain-last-checked">
                  {domain.checkedAt > 0 ? (
                    <>
                      {t('Last completed check')}{' '}
                      <time dateTime={new Date(domain.checkedAt).toISOString()}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(domain.checkedAt)}
                      </time>
                    </>
                  ) : (
                    t('No checks yet')
                  )}
                </p>
              )}
            </div>
          </section>

          {!disconnecting && !suspended && (
            <details
              key={`${domain.hostname}:${active}`}
              className="domain-dns window-section-divider"
              open={!active}
            >
              <summary>
                <span>{t(active ? 'DNS records' : 'DNS records to configure')}</span>
                <small>{t(active ? 'View configuration' : 'At your domain provider')}</small>
              </summary>
              <div className="domain-dns-intro">
                <p>
                  {t(
                    'Open DNS → Records at your domain provider. Add each record using the exact fields below, save, then click Check connection above.',
                  )}
                </p>
              </div>
              {settings?.target && (
                <DnsRecord
                  record={{ type: 'CNAME', name: domain.hostname, value: settings.target }}
                  purpose="Points your address to Wya"
                />
              )}
              {domain.records.map((record, index) => (
                <DnsRecord
                  key={`${record.type}:${record.name}:${record.value}`}
                  record={record}
                  purpose={
                    index === 0
                      ? 'Proves you own this domain'
                      : 'Required for domain or HTTPS verification'
                  }
                />
              ))}
              <details className="domain-dns-help window-section-divider">
                <summary>{t('Help with DNS fields')}</summary>
                <dl>
                  <div>
                    <dt>{t('Host / Name')}</dt>
                    <dd>{t('Identifies the DNS record. Paste the record name here.')}</dd>
                  </div>
                  <div>
                    <dt>{t('Content / Value')}</dt>
                    <dd>
                      {t('The destination or verification value. Paste the complete value here.')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Shortened names')}</dt>
                    <dd>
                      {t(
                        'Some providers ask for @ instead of the root domain, and _wya instead of _wya.your-domain.com. Use the full names if your provider accepts them.',
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Cloudflare</dt>
                    <dd>
                      {t('Set these records to DNS only. Leave your email records unchanged.')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Root domains')}</dt>
                    <dd>
                      {t(
                        'Your provider must support CNAME flattening or ALIAS/ANAME for a root domain. Otherwise, connect a subdomain such as www.example.com.',
                      )}
                    </dd>
                  </div>
                </dl>
              </details>
            </details>
          )}

          {!disconnecting && (
            <section
              className="domain-address window-section-divider"
              aria-labelledby="domain-address-heading"
            >
              <div>
                <h3 id="domain-address-heading">{t('Your Wya address')}</h3>
                <a
                  className="text-link"
                  href={`https://wya.im/${profile.handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  wya.im/{profile.handle}
                  <ArrowUpRightIcon size={14} aria-hidden="true" />
                </a>
              </div>
              {feedbackAction === 'redirect' && notices}
              {active ? (
                <fieldset disabled={busy || !settings?.available} className="domain-address-mode">
                  <legend className="sr-only">{t('Original Wya address')}</legend>
                  {[false, true].map((redirect) => (
                    <label key={String(redirect)}>
                      <input
                        type="radio"
                        name="domain-mode"
                        checked={domain.redirect === redirect}
                        disabled={redirect && !settings?.entitled}
                        onChange={() =>
                          void change({ action: 'redirect', hostname: domain.hostname, redirect })
                        }
                      />
                      <span>
                        <strong>
                          {t(redirect ? 'Redirect to custom domain' : 'Keep both addresses')}
                        </strong>
                        <small>
                          {t(
                            redirect
                              ? 'Send visitors and short links from your Wya address to your domain.'
                              : 'Visitors can use either address to open your space.',
                          )}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="field-description">
                  {t(
                    'This address still opens your space. Redirect options become available after connection.',
                  )}
                </p>
              )}
            </section>
          )}

          {!disconnecting && (
            <section
              className="domain-disconnect window-section-divider"
              aria-labelledby="domain-disconnect-heading"
            >
              <h3 id="domain-disconnect-heading">
                {t(removing ? 'Disconnect {hostname}?' : 'Disconnect domain', {
                  hostname: domain.hostname,
                })}
              </h3>
              <p>
                {t(
                  removing
                    ? 'This address will stop opening your space. Your content stays at your Wya address.'
                    : 'Unlink this address from your space. You can connect it again later.',
                )}
              </p>
              <p className="field-description">
                {t(
                  'This does not cancel your domain registration or change any DNS records at your provider.',
                )}
              </p>
              {feedbackAction === 'remove' && notices}
              <div className="domain-actions">
                <button
                  type="button"
                  className="button button-small"
                  disabled={busy || !settings?.available}
                  onClick={() =>
                    removing
                      ? void change({ action: 'remove', hostname: domain.hostname })
                      : setRemoving(true)
                  }
                >
                  <LinkBreakIcon size={16} aria-hidden="true" />
                  {t(removing ? 'Confirm disconnection' : 'Disconnect domain')}
                </button>
                {removing && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setRemoving(false)}
                  >
                    {t('Keep domain connected')}
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function DnsRecord({ record, purpose }: { record: DomainRecord; purpose: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'name' | 'value' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="domain-dns-record">
      <div className="domain-record-heading">
        <strong>{record.type}</strong>
        <span>{t(purpose)}</span>
      </div>
      {(['name', 'value'] as const).map((key) => (
        <label key={key}>
          <span>{t(key === 'name' ? 'Host / Name' : 'Content / Value')}</span>
          <div>
            <input readOnly value={record[key]} onFocus={(event) => event.currentTarget.select()} />
            <button
              type="button"
              className="icon-button"
              aria-label={t(
                copied === key
                  ? 'Copied'
                  : key === 'name'
                    ? 'Copy record name'
                    : 'Copy record value',
              )}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(record[key]);
                  setCopied(key);
                  setCopyFailed(false);
                } catch {
                  setCopyFailed(true);
                }
              }}
            >
              {copied === key ? (
                <CheckIcon size={16} aria-hidden="true" />
              ) : (
                <CopyIcon size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </label>
      ))}
      <span className={`domain-copy-feedback ${copyFailed ? '' : 'sr-only'}`} role="status">
        {copyFailed
          ? t('Select the field and copy it manually.')
          : copied
            ? t(copied === 'name' ? 'Record name copied' : 'Record value copied')
            : ''}
      </span>
    </div>
  );
}
