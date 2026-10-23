import { getLocale, getTranslator } from '@/lib/i18n/server';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { BriefcaseIcon } from '@phosphor-icons/react/dist/ssr/Briefcase';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { RocketIcon } from '@phosphor-icons/react/dist/ssr/Rocket';
import { SparkleIcon } from '@phosphor-icons/react/dist/ssr/Sparkle';
import { UsersIcon } from '@phosphor-icons/react/dist/ssr/Users';
import { LanguageSwitcher } from './components/language-switcher';
import { Brand } from './components/brand';
import { SiteFooter } from './components/site-footer';
import { ProfileCard } from './components/profile-card';
import { PublicAnalytics } from './components/public-analytics';
import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
import type { Profile } from '@/lib/model';
export const dynamic = 'force-dynamic';
const sample: Profile = {
  id: 'example',
  aliases: [],
  handle: 'alexcastro',
  name: 'Alex Castro',
  bio: 'Building things. Sharing ideas. Probably online.',
  theme: 'lilac',
  version: 1,
  updatedAt: '',
  links: [
    {
      slug: 'website',
      label: 'My little corner of the web',
      url: '',
      platform: 'website',
      visible: true,
    },
    { slug: 'github', label: "Things I'm building", url: '', platform: 'github', visible: true },
    {
      slug: 'instagram',
      label: 'Life outside the tabs',
      url: '',
      platform: 'instagram',
      visible: true,
    },
    { slug: 'discord', label: 'Come hang out', url: '', platform: 'discord', visible: true },
  ],
};
export default async function Home() {
  const t = await getTranslator();
  const locale = await getLocale();
  const user = await getChatGPTUser();
  const start = user ? '/dashboard' : chatGPTSignInPath('/dashboard');
  return (
    <div className="site-shell">
      <PublicAnalytics path="/" />
      <header className="site-header">
        <Brand />
        <nav>
          <LanguageSwitcher />
          <a href="#how-it-works" className="quiet-nav">
            {t('How it works')}
          </a>
          <a href={start} target="_top" className="button button-small button-dark">
            {user ? t('Your space') : t('Get your wya')}
            <ArrowUpRightIcon weight="regular" aria-hidden="true" size={16} />
          </a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" /> {' ' + t('YOUR INTERNET HAS AN ADDRESS.')}
            </div>
            <h1>
              {t('Where')}
              <br />
              {t('you')}{' '}
              <span className="at-word">
                {t('at')}
                <span className="question">?</span>
              </span>
            </h1>
            <p className="hero-description">
              {t('All your links. One very you address.')}
              <br />
              {t('Update it just by talking to ChatGPT.')}
            </p>
            <a href={start} target="_top" className="button button-dark hero-button">
              {t('Claim your name') + ' '}
              <ArrowUpRightIcon weight="regular" aria-hidden="true" size={19} />
            </a>
            <p className="small-note">{t('A little URL. A lot of you.')}</p>
            <div className="address-example">
              <span>↳</span> wya.im/<strong>{locale === 'pt-BR' ? 'voce' : 'you'}</strong>
            </div>
          </div>
          <div className="hero-art">
            <div className="orbit-word">{t('FOUND YOU ↘')}</div>
            <div className="sample-label">{t('EXAMPLE PROFILE')}</div>
            <ProfileCard
              profile={{
                ...sample,
                bio: t(sample.bio),
                links: sample.links.map((link) => ({ ...link, label: t(link.label) })),
              }}
              preview
            />
            <div className="conversation-card">
              <div className="conversation-icon">
                <SparkleIcon weight="regular" aria-hidden="true" size={20} />
              </div>
              <div>
                <p>{t('“Add my GitHub to my wya.”')}</p>
                <span>
                  <CheckIcon weight="regular" aria-hidden="true" size={13} />{' '}
                  {' ' + t('Your space, updated through ChatGPT')}
                </span>
              </div>
            </div>
          </div>
        </section>
        <section className="link-strip">
          <span>{t('ONE HOME FOR')}</span>
          <span>
            {t('your work') + ' '}
            <BriefcaseIcon weight="regular" size={18} aria-hidden="true" />
          </span>
          <span>
            {t('your side quests') + ' '}
            <RocketIcon weight="regular" size={18} aria-hidden="true" />
          </span>
          <span>
            {t('your community') + ' '}
            <UsersIcon weight="regular" size={18} aria-hidden="true" />
          </span>
          <span>
            {t("whatever's next") + ' '}
            <SparkleIcon weight="regular" size={18} aria-hidden="true" />
          </span>
        </section>
        <section className="how-section" id="how-it-works">
          <div>
            <div className="eyebrow">{t('LESS UPKEEP. MORE YOU.')}</div>
            <h2>
              {t('Less clicking.')}
              <br />
              {t('More living.')}
            </h2>
            <p>
              {t(
                'Keep your links in one place. Change them in the same conversation where your next idea starts.',
              )}
            </p>
          </div>
          <div className="steps">
            <article>
              <span>01</span>
              <div>
                <h3>{t('Claim your name')}</h3>
                <p>{t('Make wya.im/you your address. Short enough to say out loud.')}</p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>{t('Bring your world together')}</h3>
                <p>
                  {t(
                    'Add usernames, projects, and places. Every link gets its own memorable address.',
                  )}
                </p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>{t("Just say what's changed")}</h3>
                <p>
                  {t(
                    'Connect wya.im in ChatGPT to update your bio, add a link, or move things around.',
                  )}
                </p>
              </div>
            </article>
          </div>
        </section>
        <section className="closing">
          <h2>{t('See you on the internet.')}</h2>
          <a className="button button-dark" href={start} target="_top">
            {t('Get your wya') + ' '}
            <ArrowRightIcon weight="regular" aria-hidden="true" size={18} />
          </a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
