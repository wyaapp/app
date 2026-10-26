'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Popover } from 'radix-ui';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/ssr/CaretUpDown';
import { SignOutIcon } from '@phosphor-icons/react/dist/ssr/SignOut';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import { PlugIcon } from '@phosphor-icons/react/dist/ssr/Plug';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { useTranslation } from '../components/language-provider';
import type { ActiveWorkspace } from './use-workspace';
import { canExplorePremium, spaceLimitReached, SpacePlanSummary } from './space-plan-summary';

export function SpaceMenu({
  workspace,
  compact = false,
  beforeLeave,
}: {
  workspace: ActiveWorkspace;
  compact?: boolean;
  beforeLeave: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const disabled = workspace.busy && !workspace.autosaving;
  const atLimit = spaceLimitReached(workspace.plan, workspace.spaces.length);
  const upgrade = atLimit && canExplorePremium(workspace.plan);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`os-space-trigger ${compact ? 'is-compact' : ''}`}
        disabled={disabled}
        aria-label={`${t('Switch space')}: @${workspace.profile.handle}`}
      >
        <span className="os-space-avatar" aria-hidden="true">
          {workspace.profile.name.charAt(0).toUpperCase()}
        </span>
        <span>
          <small>{t('Editing space')}</small>
          <strong>@{workspace.profile.handle}</strong>
        </span>
        <CaretUpDownIcon weight="regular" aria-hidden="true" size={16} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="os-space-menu"
          side="top"
          align={compact ? 'end' : 'start'}
          sideOffset={12}
          collisionPadding={12}
          aria-label={t('Switch space')}
        >
          <h2>{t('Switch space')}</h2>
          <p>{t('Each space has its own page, links and settings.')}</p>
          <SpacePlanSummary plan={workspace.plan} count={workspace.spaces.length} />
          <div className="os-space-list">
            {workspace.spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                disabled={disabled}
                aria-pressed={space.id === workspace.profile.id}
                onClick={async () => {
                  if (!(await beforeLeave())) return;
                  if (await workspace.selectSpace(space.id)) setOpen(false);
                }}
              >
                <span className="os-space-avatar" aria-hidden="true">
                  {space.name.charAt(0).toUpperCase()}
                </span>
                <span>
                  <strong>{space.name}</strong>
                  <small>@{space.handle}</small>
                </span>
                {space.id === workspace.profile.id && (
                  <CheckIcon weight="regular" aria-hidden="true" size={18} />
                )}
              </button>
            ))}
          </div>
          <button
            className="os-create-space"
            type="button"
            disabled={disabled || (atLimit && !upgrade)}
            onClick={async () => {
              if (!(await beforeLeave())) return;
              if (upgrade) {
                if (await workspace.selectSection('billing')) setOpen(false);
                return;
              }
              if (!(await workspace.finishEntry())) return;
              workspace.setError('');
              workspace.setNotice('');
              workspace.setCreating(true);
              setOpen(false);
            }}
          >
            {upgrade ? (
              <ArrowUpRightIcon weight="regular" aria-hidden="true" size={18} />
            ) : (
              <PlusIcon weight="regular" aria-hidden="true" size={18} />
            )}
            {t(upgrade ? 'Explore Premium' : atLimit ? 'Space limit reached' : 'Create a space')}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Account tools are injected into the shared public desktop's Start menu. */
export function OwnerMenu({
  workspace,
  signOut,
  standalone,
  beforeLeave,
}: {
  workspace: ActiveWorkspace;
  signOut: string;
  standalone: boolean;
  beforeLeave: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {standalone && (
        <div className="os-start-settings">
          <h2>{t('Account')}</h2>
          <Link href="/connections">
            <PlugIcon weight="regular" aria-hidden="true" size={16} />
            {t('Connections')}
          </Link>
        </div>
      )}
      <div className="os-start-account">
        <SpaceMenu workspace={workspace} beforeLeave={beforeLeave} />
        <a
          href={signOut}
          target="_top"
          className="os-sign-out"
          aria-label={t('Sign out')}
          title={t('Sign out')}
        >
          <SignOutIcon weight="regular" aria-hidden="true" size={19} />
        </a>
      </div>
    </>
  );
}
