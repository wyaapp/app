'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { GlobeIcon } from '@phosphor-icons/react/dist/ssr/Globe';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowsClockwise';
import { useTranslation } from '../components/language-provider';
import type { DomainRecord, DomainSettings as Settings } from '@/lib/custom-domains';
import type { Profile } from '@/lib/profile-types';

export function DomainSettings({
  profile,
  onChanged,
}: {
  profile: Profile;
  onChanged: (domain: Profile['publicDomain']) => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removing, setRemoving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const endpoint = `/api/domains?spaceId=${encodeURIComponent(profile.id)}`;
  function updateSettings(data: Settings) {
    setSettings(data);
    const domain = data.domain;
    onChanged(
      domain?.status === 'active'
        ? { hostname: domain.hostname, redirect: domain.redirect }
        : undefined,
    );
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as Settings & { error?: string };
        if (!response.ok) throw new Error(data.error);
        setSettings(data);
        setError('');
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load domain settings.');
      });
    return () => controller.abort();
  }, [endpoint, attempt]);

  async function change(input: { action: string; hostname?: string; redirect?: boolean }) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as Settings & { error?: string };
      if (!response.ok) throw new Error(data.error);
      updateSettings(data);
      const domain = data.domain;
      setRemoving(false);
      setMessage(
        input.action === 'check'
          ? domain?.status === 'active'
            ? 'Your domain is ready.'
            : 'Not ready yet. Check the records below and try again in a few minutes.'
          : input.action === 'remove'
            ? 'Domain removed. Your Wya address still works.'
            : 'Domain settings saved.',
      );
    } catch (cause) {
      // A failed provider request may still have disabled routing or started removal.
      try {
        const latest = await fetch(endpoint);
        if (latest.ok) updateSettings((await latest.json()) as Settings);
      } catch {
        /* Keep the original action error when the refresh also fails. */
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update domain settings. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  const domain = settings?.domain;
  const active = domain?.status === 'active';
  return (
    <section className="editor-panel domain-settings" aria-labelledby="domain-heading">
      <div className="domain-heading">
        <GlobeIcon weight="regular" size={24} aria-hidden="true" />
        <h2 id="domain-heading">{t('Custom domain')}</h2>
      </div>
      <p className="subtle">{t('Give this space an address of its own. One domain per space.')}</p>
      {!settings && !error && <p role="status">{t('Loading…')}</p>}
      {error && (
        <p role="alert" className="domain-error">
          {t(error)}
        </p>
      )}
      {!settings && error && (
        <button type="button" className="text-link" onClick={() => setAttempt(attempt + 1)}>
          {t('Try again')}
        </button>
      )}
      {settings && !settings.available && (
        <p>{t('Custom domains are not available yet. Your Wya address works as usual.')}</p>
      )}
      {settings?.available && !domain && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change({
              action: 'connect',
              hostname: String(new FormData(event.currentTarget).get('hostname') ?? ''),
            });
          }}
          className="domain-connect"
        >
          <label>
            {t('Your domain')}
            <input
              name="hostname"
              placeholder="lecastro.me"
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
            {t('Use a domain you own, such as lecastro.me or me.example.com.')}
          </p>
          <button className="button button-primary" disabled={busy}>
            {busy ? t('Connecting…') : t('Connect domain')}
            <ArrowUpRightIcon weight="regular" aria-hidden="true" size={16} />
          </button>
        </form>
      )}
      {domain && (
        <div className="domain-details">
          <div className="domain-summary">
            <strong>{domain.hostname}</strong>
            <span className={`domain-status ${active ? 'is-active' : ''}`}>
              {t(
                active
                  ? 'Active'
                  : domain.status === 'removing'
                    ? 'Removing…'
                    : domain.status === 'ownership'
                      ? 'Verify ownership'
                      : 'Connecting domain',
              )}
            </span>
          </div>
          {active && (
            <a
              className="text-link"
              href={`https://${domain.hostname}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Visit your page')}
              <ArrowUpRightIcon weight="regular" aria-hidden="true" size={16} />
            </a>
          )}
          {domain.status !== 'removing' && (
            <details className="domain-guide" open={!active || undefined}>
              <summary>{t('Domain setup guide')}</summary>
              <ol>
                <li>
                  <h3>{t('Open your DNS settings')}</h3>
                  <p>
                    {t('Sign in where you manage your domain. Open')}{' '}
                    <strong>{t('DNS → Records')}</strong>.
                  </p>
                  <p className="field-description">
                    {t(
                      'Some providers ask for shortened names: @ and _wya for a root domain, or me and _wya.me for me.example.com. Others expect the full names shown below.',
                    )}
                  </p>
                </li>
                <li>
                  <h3>{t('Add these DNS records')}</h3>
                  <p>
                    {t(
                      'Copy the names and values exactly. Keep these records while your domain is connected.',
                    )}
                  </p>
                  {settings?.target && (
                    <DnsRecord
                      record={{ type: 'CNAME', name: domain.hostname, value: settings.target }}
                    />
                  )}
                  {domain.records.map((record) => (
                    <DnsRecord
                      key={`${record.type}:${record.name}:${record.value}`}
                      record={record}
                    />
                  ))}
                  <p className="field-description">
                    {t(
                      'For a root domain such as lecastro.me, your DNS provider must support CNAME flattening or ALIAS/ANAME. Otherwise, use a subdomain such as www.lecastro.me.',
                    )}
                  </p>
                  <p className="field-description">
                    {t(
                      'If you use Cloudflare DNS, set these records to DNS only. Do not change your email records.',
                    )}
                  </p>
                </li>
                <li>
                  <h3>{t('Check the connection')}</h3>
                  <p>
                    {t(
                      'Save your DNS changes, then check below. DNS updates can take a while. We may show additional verification records after the first check. HTTPS is enabled automatically when verification finishes.',
                    )}
                  </p>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={busy || !settings?.available}
                    onClick={() => void change({ action: 'check', hostname: domain.hostname })}
                  >
                    <ArrowsClockwiseIcon weight="regular" aria-hidden="true" size={16} />
                    {busy ? t('Checking…') : t('Check connection')}
                  </button>
                </li>
              </ol>
            </details>
          )}
          <fieldset
            disabled={busy || !settings?.available || domain.status === 'removing'}
            className="domain-address-mode"
          >
            <legend>{t('Original Wya address')}</legend>
            <p className="field-description">wya.im/{profile.handle}</p>
            <label>
              <input
                type="radio"
                name="domain-mode"
                checked={!domain.redirect}
                onChange={() =>
                  void change({ action: 'redirect', hostname: domain.hostname, redirect: false })
                }
              />
              <span>
                <strong>{t('Keep both addresses')}</strong>
                <small>{t('Visitors can use either address to open your space.')}</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="domain-mode"
                checked={domain.redirect}
                disabled={!active}
                onChange={() =>
                  void change({ action: 'redirect', hostname: domain.hostname, redirect: true })
                }
              />
              <span>
                <strong>{t('Redirect to custom domain')}</strong>
                <small>
                  {t('Send visitors and short links from your Wya address to your domain.')}
                </small>
              </span>
            </label>
            {!active && (
              <p className="field-description">
                {t('Redirects become available when your domain is active.')}
              </p>
            )}
          </fieldset>
          {removing || domain.status === 'removing' ? (
            <div className="domain-remove">
              <p>{t('Remove this domain from your space? Your Wya address will keep working.')}</p>
              <button
                type="button"
                className="button button-small"
                disabled={busy}
                onClick={() => void change({ action: 'remove', hostname: domain.hostname })}
              >
                {t('Remove domain')}
              </button>
              {domain.status !== 'removing' && (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => setRemoving(false)}
                >
                  {t('Cancel')}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="text-link"
              disabled={busy || !settings?.available}
              onClick={() => setRemoving(true)}
            >
              {t('Remove domain')}
            </button>
          )}
        </div>
      )}
      <p className="domain-feedback field-description" role="status">
        {message ? t(message) : '\u00a0'}
      </p>
    </section>
  );
}

function DnsRecord({ record }: { record: DomainRecord }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'name' | 'value' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="domain-dns-record">
      <strong>{record.type}</strong>
      {(['name', 'value'] as const).map((key) => (
        <label key={key}>
          <span>{t(key === 'name' ? 'Name' : 'Value')}</span>
          <div>
            <input
              aria-label={t(key === 'name' ? 'DNS record name' : 'DNS record value')}
              readOnly
              value={record[key]}
              onFocus={(event) => event.currentTarget.select()}
            />
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
                } catch {
                  /* The adjacent selectable input is the manual fallback. */
                }
              }}
            >
              {copied === key ? (
                <CheckIcon weight="regular" aria-hidden="true" size={16} />
              ) : (
                <CopyIcon weight="regular" aria-hidden="true" size={16} />
              )}
            </button>
          </div>
        </label>
      ))}
    </div>
  );
}
