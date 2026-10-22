'use client';

import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Gamepad2,
  Grid2X2,
  Link2,
  Monitor,
  Palette,
  PanelsTopLeft,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import type { Profile } from '@/lib/profile-types';
import { getProfileLayout } from '@/lib/profile-tabs';
import { getLayoutGroups } from '@/lib/link-layout';
import {
  profileThemeStyle,
  profileThemes,
  themeIds,
  type ProfileTheme,
} from '@/lib/profile-themes';
import { Brand } from '../brand';
import { BrandSpark } from '../brand-spark';
import { BioText } from '../bio-text';
import { ProfileAvatar } from '../profile-avatar';
import { ProfileSections } from '../profile-sections';
import { LanguageSwitcher } from '../language-switcher';
import { useTranslation } from '../language-provider';
import { DesktopWindow } from './desktop-window';
import { initialWindows, windowReducer } from './window-state';

export function DesktopProfile({
  profile,
  selectedTab,
  preview = false,
  onSelectTab,
  createHref = '/',
}: {
  profile: Profile;
  selectedTab?: string;
  preview?: boolean;
  onSelectTab?: (id: string) => void;
  createHref?: string;
}) {
  const { t } = useTranslation();
  const layout = useMemo(() => getProfileLayout(profile), [profile]);
  const firstTab = layout.tabs.find((tab) => tab.id === layout.defaultTabId)!;
  const selected = layout.tabs.find((tab) => (preview ? tab.id : tab.slug) === selectedTab);
  const selectedId = selected?.id;
  const [windows, dispatch] = useReducer(windowReducer, undefined, () =>
    initialWindows(`tab-${selected?.id ?? firstTab.id}`, selected ? `tab-${selected.id}` : 'about'),
  );
  const [color, setColor] = useState<ProfileTheme | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const locationRead = useRef(false);
  const dockButtons = useRef(new Map<string, HTMLButtonElement>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = windows.order.at(-1);
  const theme = color ?? profile.theme;
  const address = `https://wya.im/${profile.handle}`;
  const apps = [
    { id: 'about', title: t('About me'), Icon: UserRound, color: 'lilac' },
    ...layout.tabs.map((tab, index) => {
      const slugs = new Set(getLayoutGroups(tab).flatMap((group) => group.slugs));
      const items = profile.links.filter((item) => slugs.has(item.slug) && item.visible);
      const games =
        items.length > 0 &&
        items.every((item) => item.kind === 'interest' || item.kind === 'collection');
      const projects = items.length > 0 && items.every((item) => item.kind === 'project');
      return {
        id: `tab-${tab.id}`,
        title: tab.title,
        Icon: games ? Gamepad2 : projects ? PanelsTopLeft : Link2,
        color: ['yellow', 'lime', 'peach', 'sky', 'rose'][index],
      };
    }),
    { id: 'appearance', title: t('Make it yours'), Icon: Palette, color: 'peach' },
  ];

  function openApp(id: string) {
    dispatch({ type: 'open', id });
    if (workspace.current && workspace.current.clientWidth <= 960)
      workspace.current.scrollTo({ top: 0 });
    const tab = layout.tabs.find((tab) => `tab-${tab.id}` === id);
    if (tab) {
      if (preview) onSelectTab?.(tab.id);
      else {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tab.slug);
        url.hash = '';
        if (url.href !== window.location.href) window.history.pushState(null, '', url);
      }
    }
  }

  function hideApp(id: string) {
    dispatch({ type: 'hide', id });
    dockButtons.current.get(id)?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (preview && selectedId) dispatch({ type: 'open', id: `tab-${selectedId}` });
  }, [preview, selectedId]);

  // Native tab URLs and item fragments keep working without remounting the desktop.
  useEffect(() => {
    if (preview) return;
    let frame = 0;
    function readLocation(event?: Event) {
      const url = new URL(window.location.href);
      let tab = layout.tabs.find((tab) => tab.slug === url.searchParams.get('tab'));
      let fragment = '';
      try {
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        /* Ignore malformed fragments. */
      }
      if (fragment) {
        const item = profile.links.find(
          (item) =>
            [`widget-${item.id ?? item.slug}`, `interest-${item.id ?? item.slug}`].includes(
              fragment,
            ) ||
            item.collection?.items.some(
              (child) => `interest-${child.id ?? child.slug}` === fragment,
            ),
        );
        if (item)
          tab =
            layout.tabs.find((tab) =>
              getLayoutGroups(tab).some((group) => group.slugs.includes(item.slug)),
            ) ?? tab;
      }
      if (tab) dispatch({ type: 'open', id: `tab-${tab.id}` });
      else if (event) dispatch({ type: 'open', id: 'about' });
      if (fragment)
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() =>
            document.getElementById(fragment)?.scrollIntoView({ block: 'nearest' }),
          );
        });
    }
    if (!locationRead.current) {
      readLocation();
      locationRead.current = true;
    }
    window.addEventListener('popstate', readLocation);
    window.addEventListener('hashchange', readLocation);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', readLocation);
      window.removeEventListener('hashchange', readLocation);
    };
  }, [layout, profile.links, preview]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setManualCopy(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setManualCopy(true);
    }
  }

  return (
    <div
      className={`desktop-profile ${preview ? 'desktop-preview' : ''}`}
      style={profileThemeStyle(theme) as CSSProperties}
    >
      <header className="desktop-system-bar">
        <Brand />
        <span className="desktop-address">
          <span className="status-dot" />
          wya.im/{profile.handle}
        </span>
        <button
          className="button button-small desktop-copy"
          type="button"
          onClick={() => void copyAddress()}
          aria-label={t('Copy profile link')}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
          <span>{t('Copy profile link')}</span>
        </button>
      </header>
      <div className="desktop-workspace" ref={workspace}>
        <div className="desktop-wallpaper-word" aria-hidden="true">
          where you at?
        </div>
        <nav className="desktop-shortcuts" aria-label={t('Desktop apps')}>
          {apps.map(({ id, title, Icon, color }) => (
            <button
              type="button"
              key={id}
              onClick={() => openApp(id)}
              aria-controls={`desktop-${id}`}
            >
              <span className={`desktop-app-icon desktop-color-${color}`}>
                <Icon size={28} strokeWidth={1.8} />
              </span>
              <span>{title}</span>
            </button>
          ))}
        </nav>
        {!active && (
          <div className="desktop-welcome">
            <span className="eyebrow">@{profile.handle}</span>
            <h2>{t('Make yourself at home.')}</h2>
            <button className="button" type="button" onClick={() => openApp('about')}>
              {t('Meet {name}', { name: profile.name })}
              <ArrowRight size={18} />
            </button>
          </div>
        )}
        <p className="desktop-hint">
          {t('A little corner of the internet.')}
          <span>{t('Open a window. Have a look around.')}</span>
        </p>
        {apps.map(({ id, title, Icon }, index) => {
          const tab = layout.tabs.find((tab) => `tab-${tab.id}` === id);
          return (
            <DesktopWindow
              key={`${resetKey}:${id}`}
              id={id}
              title={title}
              icon={<Icon size={17} />}
              index={index}
              open={windows.order.includes(id)}
              active={active === id}
              maximized={windows.maximized.includes(id)}
              layer={windows.order.indexOf(id)}
              workspace={workspace}
              onFocus={() => dispatch({ type: 'open', id })}
              onHide={() => hideApp(id)}
              onMaximize={() => dispatch({ type: 'maximize', id })}
            >
              {id === 'about' ? (
                <div className="desktop-identity">
                  <div className="desktop-identity-top">
                    <ProfileAvatar name={profile.name} url={profile.pictureUrl} />
                    <span className="desktop-identity-spark" aria-hidden="true">
                      <BrandSpark />
                    </span>
                  </div>
                  <span className="eyebrow">{t('HEY, I AM')}</span>
                  {preview ? <h2>{profile.name}</h2> : <h1>{profile.name}</h1>}
                  <span className="desktop-handle">@{profile.handle}</span>
                  <p className="desktop-bio">
                    <BioText text={profile.bio || t('A little corner of the internet.')} />
                  </p>
                  <button
                    className="button"
                    type="button"
                    onClick={() => openApp(`tab-${firstTab.id}`)}
                  >
                    {t('Find me around')}
                    <ArrowRight size={18} />
                  </button>
                  <div className="desktop-identity-footer">
                    <span>{t('WHERE YOU AT?')}</span>
                    <strong>{t('RIGHT HERE ↗')}</strong>
                  </div>
                </div>
              ) : tab ? (
                <ProfileSections profile={profile} tab={tab} preview={preview} />
              ) : (
                <div className="desktop-appearance">
                  <h3>{t('Make it yours')}</h3>
                  <p>{t('Pick a color. Just for your visit.')}</p>
                  <div className="desktop-colors" role="group" aria-label={t('Your color')}>
                    {themeIds.map((value) => (
                      <button
                        type="button"
                        key={value}
                        onClick={() => setColor(value)}
                        aria-pressed={theme === value}
                        style={{
                          background: profileThemes[value].color,
                          color: profileThemes[value].text,
                        }}
                      >
                        <span>{t(profileThemes[value].label)}</span>
                        {theme === value && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                  <LanguageSwitcher />
                  <button
                    className="text-link desktop-reset"
                    type="button"
                    onClick={() => {
                      setColor(null);
                      setResetKey((key) => key + 1);
                      dispatch({ type: 'reset', firstTab: `tab-${firstTab.id}`, active: 'about' });
                      dockButtons.current.get('about')?.focus({ preventScroll: true });
                    }}
                  >
                    <RotateCcw size={16} />
                    {t('Reset desktop')}
                  </button>
                </div>
              )}
            </DesktopWindow>
          );
        })}
      </div>
      <footer className="desktop-taskbar">
        <button
          className="desktop-home-button"
          type="button"
          onClick={() => dispatch({ type: 'clear' })}
          aria-label={t('Show desktop')}
          title={t('Show desktop')}
        >
          <Grid2X2 size={21} />
        </button>
        <nav className="desktop-dock" aria-label={t('Open a window')}>
          {apps.map(({ id, title, Icon }) => (
            <button
              type="button"
              key={id}
              ref={(node) => {
                if (node) dockButtons.current.set(id, node);
                else dockButtons.current.delete(id);
              }}
              onClick={() => openApp(id)}
              aria-pressed={active === id}
              aria-controls={`desktop-${id}`}
              className={windows.order.includes(id) ? 'is-open' : ''}
              title={title}
            >
              <Icon size={19} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
        <a className="desktop-create" href={createHref} target="_top">
          {t('Get your wya')}
          <ArrowUpRight size={15} />
        </a>
        {!preview && <DesktopClock />}
        <Monitor className="desktop-taskbar-end" size={19} aria-hidden="true" />
      </footer>
      <div className="desktop-copy-status" role="status">
        {copied && (
          <span>
            <Check size={16} />
            {t('Profile link copied.')}
          </span>
        )}
      </div>
      {manualCopy && (
        <div className="desktop-manual-copy">
          <label>
            {t('Copy profile link')}
            <input
              readOnly
              value={address}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
            />
          </label>
          <button type="button" onClick={() => setManualCopy(false)}>
            {t('Done')}
          </button>
        </div>
      )}
    </div>
  );
}

function DesktopClock() {
  const { locale } = useTranslation();
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setTime(new Date());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time className="desktop-clock" dateTime={time?.toISOString()}>
      {time ? time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '--:--'}
    </time>
  );
}
