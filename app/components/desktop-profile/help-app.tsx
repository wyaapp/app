'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/ssr/DiscordLogo';
import { DiscordSetupSteps } from '@/app/dashboard/discord-setup-guide';
import { useTranslation } from '../language-provider';

const guides = [
  {
    id: 'discord-widget',
    category: 'Widgets',
    title: 'Discord widget',
    description: 'Show your server and online members on your page.',
    Icon: DiscordLogoIcon,
    heading: 'Set up your Discord widget',
    Content: () => <DiscordSetupSteps context="help" />,
  },
] as const;

type HelpGuideId = (typeof guides)[number]['id'];
export type HelpGuideRequest = { id: HelpGuideId; sequence: number };

export function HelpApp({
  requestedGuide,
  onReturnToEditor,
}: {
  requestedGuide?: HelpGuideRequest;
  onReturnToEditor?: () => void;
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
          <guide.Content />
          {onReturnToEditor && (
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
                          <Icon weight="regular" size={24} />
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
