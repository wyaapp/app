'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/ssr/DiscordLogo';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import { KeyboardIcon } from '@phosphor-icons/react/dist/ssr/Keyboard';
import { SparkleIcon } from '@phosphor-icons/react/dist/ssr/Sparkle';
import { DiscordSetupSteps } from '@/app/dashboard/discord-setup-guide';
import { ChatGPTPanel } from '@/app/dashboard/chatgpt-panel';
import { useTranslation } from '../language-provider';
import { BasicHelp, KeyboardHelp } from './help-basics';

const guides = [
  {
    id: 'home',
    category: 'Getting started',
    title: 'Home and windows',
    description: 'Open apps, move icons and organize your windows.',
    Icon: HouseIcon,
    heading: 'Home and windows',
  },
  {
    id: 'files',
    category: 'Getting started',
    title: 'Files and folders',
    description: 'Create, find and organize your documents.',
    Icon: FolderOpenIcon,
    heading: 'Files and folders',
  },
  {
    id: 'publishing',
    category: 'Getting started',
    title: 'Drafts and publishing',
    description: 'Understand what is saved and what visitors can see.',
    Icon: UploadSimpleIcon,
    heading: 'Drafts and publishing',
  },
  {
    id: 'shortcuts',
    category: 'Getting started',
    title: 'Keyboard shortcuts',
    description: 'Navigate and organize with the keyboard.',
    Icon: KeyboardIcon,
    heading: 'Keyboard shortcuts',
  },
  {
    id: 'chatgpt',
    category: 'Connections and widgets',
    title: 'Use ChatGPT',
    description: 'Connect wya.im and edit your space in a conversation.',
    Icon: SparkleIcon,
    heading: 'Use ChatGPT',
  },
  {
    id: 'discord-widget',
    category: 'Connections and widgets',
    title: 'Discord widget',
    description: 'Show your server and online members on your page.',
    Icon: DiscordLogoIcon,
    heading: 'Set up your Discord widget',
  },
] as const;

type HelpGuideId = (typeof guides)[number]['id'];
export type HelpGuideRequest = { id: HelpGuideId | null; sequence: number };

export function HelpApp({
  requestedGuide,
  onReturnToEditor,
  standalone,
  handle,
}: {
  requestedGuide?: HelpGuideRequest;
  onReturnToEditor?: () => void;
  standalone: boolean;
  handle: string;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [navigation, setNavigation] = useState<{
    guide: HelpGuideId | null;
    request?: number;
  }>(() => ({ guide: requestedGuide?.id ?? null, request: requestedGuide?.sequence }));
  if (requestedGuide && requestedGuide.sequence !== navigation.request)
    setNavigation({ guide: requestedGuide.id, request: requestedGuide.sequence });
  const guide = guides.find((guide) => guide.id === navigation.guide);

  // Moving between Help pages keeps keyboard focus with the newly opened content.
  useEffect(() => {
    heading.current?.closest('.desktop-window-body')?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [navigation.guide, navigation.request]);

  return (
    <div className="desktop-help">
      {guide ? (
        <article aria-labelledby={titleId}>
          <nav className="desktop-help-nav" aria-label={t('Help navigation')}>
            <button
              type="button"
              onClick={() => setNavigation((current) => ({ ...current, guide: null }))}
            >
              <ArrowLeftIcon weight="regular" size={18} aria-hidden="true" />
              {t('Back to Help home')}
            </button>
          </nav>
          <header className="desktop-help-heading">
            <h2 id={titleId} ref={heading} tabIndex={-1}>
              {t(guide.heading)}
            </h2>
          </header>
          {guide.id === 'discord-widget' ? (
            <DiscordSetupSteps context="help" />
          ) : guide.id === 'chatgpt' ? (
            <ChatGPTPanel standalone={standalone} handle={handle} embedded />
          ) : guide.id === 'shortcuts' ? (
            <KeyboardHelp />
          ) : (
            <BasicHelp guide={guide.id} />
          )}
          {onReturnToEditor && guide.id === 'discord-widget' && (
            <footer className="desktop-help-next">
              <button type="button" className="button button-small" onClick={onReturnToEditor}>
                <ArrowLeftIcon weight="regular" size={18} aria-hidden="true" />
                {t('Back to editor')}
              </button>
            </footer>
          )}
        </article>
      ) : (
        <section aria-labelledby={titleId}>
          <header className="desktop-help-heading">
            <h2 id={titleId} ref={heading} tabIndex={-1}>
              {t('How can we help?')}
            </h2>
            <p>{t('Step-by-step guides for your space.')}</p>
          </header>
          {[...new Set(guides.map((guide) => guide.category))].map((category) => (
            <section className="desktop-help-category" key={category}>
              <h3>{t(category)}</h3>
              <ul className="desktop-help-guides">
                {guides
                  .filter((guide) => guide.category === category)
                  .map(({ id, title, description, Icon }) => (
                    <li key={id}>
                      <button
                        type="button"
                        className="desktop-help-guide-card"
                        onClick={() => setNavigation((current) => ({ ...current, guide: id }))}
                      >
                        <span className="desktop-help-guide-icon" aria-hidden="true">
                          <Icon weight="duotone" size={24} />
                        </span>
                        <span className="desktop-help-guide-label">
                          <strong>{t(title)}</strong>
                          <span>{t(description)}</span>
                        </span>
                        <ArrowRightIcon weight="regular" size={18} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </section>
      )}
    </div>
  );
}
