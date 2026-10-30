'use client';

import { useId, useState } from 'react';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { CreditCardIcon } from '@phosphor-icons/react/dist/ssr/CreditCard';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/ssr/DiscordLogo';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/dist/ssr/EnvelopeSimple';
import { LifebuoyIcon } from '@phosphor-icons/react/dist/ssr/Lifebuoy';
import { QuestionIcon } from '@phosphor-icons/react/dist/ssr/Question';
import { emailLink } from '@/lib/email-links';
import { useTranslation } from '../components/language-provider';

const supportAddress = 'support@wya.im';

export function SupportApp({
  onOpenHelp,
  onOpenBilling,
}: {
  onOpenHelp: () => void;
  onOpenBilling: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [copyStatus, setCopyStatus] = useState('');
  const supportLink = emailLink(supportAddress, `[wya.im] ${t('Support')}`);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(supportAddress);
      setCopyStatus('Email address copied.');
    } catch {
      setCopyStatus('Select and copy the email address above.');
    }
  }

  return (
    <section className="editor-panel support-app" aria-labelledby={`${id}-heading`}>
      <header className="support-heading">
        <LifebuoyIcon size={24} weight="duotone" aria-hidden="true" />
        <h2 id={`${id}-heading`}>{t('Human support, personal replies.')}</h2>
      </header>
      <p className="support-intro">
        {t(
          'I read and reply to support emails myself. wya.im is a one-person project, so it may take me a little time to get back to you.',
        )}
      </p>

      <div className="support-contact panel-section-divider">
        <div className="support-contact-address">
          <span>{t('For account, billing, or technical help')}</span>
          <a href={supportLink}>{supportAddress}</a>
        </div>
        <div className="support-contact-actions">
          <a className="button button-small" href={supportLink}>
            <EnvelopeSimpleIcon size={18} aria-hidden="true" />
            {t('Email support')}
          </a>
          <button type="button" className="support-copy" onClick={() => void copyAddress()}>
            <CopyIcon size={18} aria-hidden="true" />
            {t('Copy email')}
          </button>
        </div>
        <p className="support-caption">
          {t(
            'Opens your email app. Write and send your message there, or use the address above in your webmail.',
          )}
        </p>
        <p className="support-copy-status" role="status">
          {copyStatus ? t(copyStatus) : ''}
        </p>
      </div>

      <nav
        className="support-resources panel-section-divider"
        aria-label={t('More ways to get help')}
      >
        <a
          className="support-community"
          href="https://wya.im/on/discord"
          target="_blank"
          rel="noopener noreferrer"
        >
          <DiscordLogoIcon size={25} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{t('Community on Discord')}</strong>
            <small>
              {t(
                'Ask questions, share ideas, and talk about wya.im. For personal support, email me.',
              )}
            </small>
          </span>
          <ArrowUpRightIcon className="support-resource-arrow" size={18} aria-hidden="true" />
        </a>
        <button type="button" onClick={onOpenHelp}>
          <QuestionIcon size={25} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{t('Help guides')}</strong>
            <small>{t('Step-by-step help with your space.')}</small>
          </span>
        </button>
        <button type="button" onClick={onOpenBilling}>
          <CreditCardIcon size={25} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{t('Plans & billing')}</strong>
            <small>{t('View your plan and manage your subscription.')}</small>
          </span>
        </button>
      </nav>
    </section>
  );
}
