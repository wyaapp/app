'use client';
import { useTranslation } from '@/app/components/language-provider';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export function ChatGPTPanel({ standalone, handle }: { standalone: boolean; handle: string }) {
  const { t } = useTranslation();
  return (
    <section className="chat-panel">
      <div className="chat-panel-symbol">
        <Sparkles size={32} />
      </div>
      <h2>{t('Your space. In your own words.')}</h2>
      <p>
        {t(
          'Connect wya.im in ChatGPT, then name the space you want to change. Each space has its own profile, links, and history.',
        )}
      </p>
      {standalone ? (
        <>
          <ol>
            <li>
              {t('Create a custom connection in ChatGPT with') + ' '}
              <strong>https://wya.im/mcp</strong>.
            </li>
            <li>
              {t(
                'Choose OAuth, leave the client ID and secret blank, then sign in with your email code and review access.',
              )}
            </li>
            <li>{t('Start a conversation and select wya.im.')}</li>
          </ol>
          <p className="subtle">
            {t(
              'Custom connections depend on your ChatGPT account or workspace. Manage access from',
            )}{' '}
            <Link href="/connections">{t('Your connections')}</Link>.
          </p>
        </>
      ) : (
        <ol>
          <li>{t("Open ChatGPT's plugin settings.")}</li>
          <li>
            {t('Find') + ' '}
            <strong>wya.im</strong>{' '}
            {' ' +
              t(
                'in your available plugins and connect it. During this private preview, access is limited to the site owner.',
              )}
          </li>
          <li>{t('Start a conversation and mention wya.im.')}</li>
        </ol>
      )}
      <div className="prompt-examples">
        <p>{t('“List my wya.im spaces.”')}</p>
        <p>
          {t('“Add my GitHub to my @')}
          {handle} {' ' + t('space.”')}
        </p>
        <p>{t('“Move my portfolio to the top.”')}</p>
        <p>{t('“Undo my last profile change.”')}</p>
      </div>
      <p className="subtle">
        {t(
          'Every update belongs to your signed-in account. You can review and restore previous versions in Change history.',
        )}
      </p>
    </section>
  );
}
