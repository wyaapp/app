'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/ssr/SpeakerHigh';
import { UsersIcon } from '@phosphor-icons/react/dist/ssr/Users';
import type { LinkItem } from '@/lib/profile-types';
import type { DiscordMember, DiscordWidgetData } from '@/lib/discord-widget-types';
import { useTranslation } from './language-provider';
import { ContentCover } from './content-cover';
import { LinkIcon } from './link-icon';
import { useDocumentCard } from './document-card-context';

export function DiscordWidget({
  item,
  handle,
  preview,
  initialData,
  presentation = 'document',
}: {
  item: LinkItem;
  handle: string;
  preview: boolean;
  initialData?: DiscordWidgetData;
  presentation?: 'document' | 'window';
}) {
  const card = useDocumentCard(handle);
  const query = preview
    ? new URLSearchParams({ guildId: item.discord!.guildId })
    : new URLSearchParams({
        handle,
        slug: item.slug,
        ...(card.fileId ? { fileId: card.fileId } : {}),
      });
  // A server change resets the fetch state without remounting the surrounding editor.
  return (
    <LoadedWidget
      key={query.toString()}
      item={item}
      handle={handle}
      preview={preview}
      url={`/api/discord-widget?${query}`}
      initialData={initialData}
      presentation={presentation}
    />
  );
}

function LoadedWidget({
  item,
  handle,
  preview,
  url,
  initialData,
  presentation = 'document',
}: {
  item: LinkItem;
  handle: string;
  preview: boolean;
  url: string;
  initialData?: DiscordWidgetData;
  presentation?: 'document' | 'window';
}) {
  const { t } = useTranslation();
  const card = useDocumentCard(handle);
  const [data, setData] = useState(initialData);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const result = (await response.json()) as DiscordWidgetData & { error?: string };
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setData(result);
      } catch {
        if (!controller.signal.aborted) setError('This Discord widget is temporarily unavailable.');
      }
    })();
    return () => controller.abort();
  }, [url, attempt, initialData]);
  return (
    <article
      className="profile-tile discord-widget"
      data-presentation={presentation}
      id={card.domId('widget', item)}
      data-analytics-item={card.analyticsId(item, preview)}
    >
      <header className="discord-widget-heading">
        <LinkIcon platform="discord" size={28} />
        <div>
          <strong className="profile-tile-title">{data?.name ?? item.label}</strong>
          <small>{data ? t('{count} online', { count: data.online }) : 'Discord'}</small>
        </div>
      </header>
      <div
        className="discord-widget-body"
        tabIndex={0}
        role="region"
        aria-label={t('Server members and channels')}
      >
        {data ? (
          <DiscordMembers data={data} />
        ) : (
          <div className="discord-widget-empty" role="status">
            <UsersIcon weight="regular" size={28} aria-hidden="true" />
            <p>{t(error || 'Loading Discord…')}</p>
            {error && (
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setError('');
                  setAttempt((value) => value + 1);
                }}
              >
                {t('Retry')}
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="discord-widget-footer">
        {data?.inviteUrl ? (
          preview ? (
            <span className="button button-dark discord-join-preview">
              {t('Join server')} <ArrowUpRightIcon weight="regular" aria-hidden="true" size={16} />
            </span>
          ) : (
            <a
              href={data.inviteUrl}
              className="button button-dark"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Join server')} <ArrowUpRightIcon weight="regular" aria-hidden="true" size={16} />
            </a>
          )
        ) : (
          <small>{data ? t('No invite available') : t('Discord server')}</small>
        )}
      </footer>
    </article>
  );
}

function DiscordMembers({ data }: { data: DiscordWidgetData }) {
  const { t } = useTranslation();
  const channels = new Set(data.channels.map((channel) => channel.id));
  const others = data.members.filter(
    (member) => !member.channelId || !channels.has(member.channelId),
  );
  return (
    <>
      {data.channels.map((channel) => (
        <div className="discord-member-group" key={channel.id}>
          <h3>
            <SpeakerHighIcon weight="regular" size={15} aria-hidden="true" />
            {channel.name}
          </h3>
          <MemberList members={data.members.filter((member) => member.channelId === channel.id)} />
        </div>
      ))}
      {others.length > 0 && (
        <div className="discord-member-group">
          <h3>{t('Members online')}</h3>
          <MemberList members={others} />
        </div>
      )}
      {!data.members.length && (
        <p className="discord-no-members">{t('No members to show right now.')}</p>
      )}
    </>
  );
}

function MemberList({ members }: { members: DiscordMember[] }) {
  const { t } = useTranslation();
  const statuses = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };
  if (!members.length) return null;
  return (
    <ul className="discord-members">
      {members.map((member, index) => (
        <li key={`${member.id}-${index}`}>
          <span className="discord-member-avatar">
            <ContentCover
              url={member.avatarUrl}
              className="discord-avatar-image"
              fallback={
                <span className="discord-avatar-image discord-avatar-fallback">
                  {member.name.slice(0, 1)}
                </span>
              }
            />
            <span
              className={`discord-presence discord-presence-${member.status}`}
              role="img"
              aria-label={t(statuses[member.status])}
            />
          </span>
          <span className="discord-member-name">
            {member.name}
            {member.activity && <small>{member.activity}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}
