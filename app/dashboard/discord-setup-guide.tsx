'use client';
import { useId } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown } from 'lucide-react';
import { useTranslation } from '../components/language-provider';

// Keep each translated sentence intact while emphasizing its menu labels.
function GuideText({ children }: { children: string }) {
  const { t } = useTranslation();
  return t(children)
    .split(/(\*\*[^*]+\*\*|→)/g)
    .map((part, index) => {
      if (part === '→')
        return (
          <ArrowRight key={index} className="discord-guide-arrow" size={14} aria-hidden="true" />
        );
      return part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part;
    });
}

export function DiscordSetupGuide({
  open,
  onToggle,
  onContinue,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  onContinue: () => void;
}) {
  const { t, locale } = useTranslation();
  const headingId = useId(),
    contentId = useId();
  return (
    <section className="discord-setup-guide" aria-labelledby={headingId}>
      <div className="discord-guide-heading">
        <h3 id={headingId}>
          <BookOpen size={20} aria-hidden="true" />
          {t('Set up your Discord widget')}
        </h3>
        <button
          type="button"
          className="text-link discord-guide-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onToggle(!open)}
        >
          {t(open ? 'Hide guide' : 'Show guide')}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      <div id={contentId} hidden={!open}>
        <div className="discord-guide-intro">
          <p>{t('A few steps in Discord, then come back here to preview your widget.')}</p>
          <a
            href="https://discord.com/channels/@me"
            target="_blank"
            rel="noopener noreferrer"
            className="text-link"
          >
            {t('Open Discord')} <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
        <ol className="discord-guide-steps">
          <li>
            <span className="discord-guide-number" aria-hidden="true">
              1
            </span>
            <div>
              <h4>{t('Open your server settings')}</h4>
              <p>
                <GuideText>
                  {
                    'On Discord desktop or web, select your server. At the top left, choose **your server name** → **Server Settings**.'
                  }
                </GuideText>
              </p>
              <p className="discord-guide-hint">
                <GuideText>
                  {
                    'Cannot see **Server Settings**? Ask the server owner or someone with **Manage Server** permission to help.'
                  }
                </GuideText>
              </p>
            </div>
          </li>
          <li>
            <span className="discord-guide-number" aria-hidden="true">
              2
            </span>
            <div>
              <h4>{t('Turn on the server widget')}</h4>
              <p>
                <GuideText>
                  {
                    'Select **Engagement** → scroll down to **Server Widget** → turn on **Enable Server Widget**.'
                  }
                </GuideText>
              </p>
              <p>
                <GuideText>
                  {
                    'Want a **Join server** button? Choose an **Invite Channel**, then save your changes.'
                  }
                </GuideText>
              </p>
              <p className="discord-guide-hint">
                {t(
                  'Online members and public voice channels will be visible. Chat messages stay in Discord. No bot or secret key is needed.',
                )}
              </p>
            </div>
          </li>
          <li>
            <span className="discord-guide-number" aria-hidden="true">
              3
            </span>
            <div>
              <h4>{t('Copy your server ID')}</h4>
              <p>
                <GuideText>
                  {
                    'Copy the **Server ID** shown in the widget settings. Paste it below → choose **Load server** to check the connection.'
                  }
                </GuideText>
              </p>
              <details className="discord-id-help">
                <summary>{t('Cannot find the server ID?')}</summary>
                <p>
                  <GuideText>
                    {
                      'In **User Settings** → **Advanced**, enable **Developer Mode**. Right-click your server icon → **Copy Server ID**.'
                    }
                  </GuideText>{' '}
                  <a
                    className="text-link"
                    href={`https://support.discord.com/hc/${locale === 'pt-BR' ? 'pt-br' : 'en-us'}/articles/206346498`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('Discord help')}
                  </a>
                </p>
              </details>
            </div>
          </li>
        </ol>
        <div className="discord-guide-next">
          <p>{t('Already set up? You can go straight to your server ID.')}</p>
          <button type="button" className="text-link" onClick={onContinue}>
            {t('Enter server ID')}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
