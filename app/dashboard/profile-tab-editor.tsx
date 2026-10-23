'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useId, useRef, useState } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/ssr/DownloadSimple';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import { DropdownMenu } from 'radix-ui';
import { MAX_PROFILE_TABS, removeProfileTab, type ProfileLayout } from '@/lib/profile-tabs';
import { RemoveTabControl } from './remove-tab-control';

export function ProfileTabEditor({
  layout,
  activeId,
  busy,
  onChange,
  onSelect,
  onExport,
  onImport,
  importBlocked,
}: {
  layout: ProfileLayout;
  activeId: string;
  busy: boolean;
  onChange: (layout: ProfileLayout) => void;
  onSelect: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  importBlocked: boolean;
}) {
  const { t } = useTranslation();
  const settingsPanelId = useId();
  const [settingsId, setSettingsId] = useState('');
  const settingsButton = useRef<HTMLButtonElement>(null);
  const tab = layout.tabs.find((tab) => tab.id === activeId)!;
  const index = layout.tabs.indexOf(tab);
  function update(fields: Partial<typeof tab>) {
    onChange({
      ...layout,
      tabs: layout.tabs.map((item) => (item.id === tab.id ? { ...item, ...fields } : item)),
    });
  }
  function move(offset: number) {
    const tabs = [...layout.tabs];
    tabs.splice(index, 1);
    tabs.splice(index + offset, 0, tab);
    onChange({ ...layout, tabs });
  }
  return (
    <section className="tab-editor" aria-label={t('Profile tabs')}>
      <nav className="profile-tabs editor-tabs" aria-label={t('Edit a profile tab')}>
        {layout.tabs.map((item) => (
          <div key={item.id} className={`editor-tab${item.id === activeId ? ' active' : ''}`}>
            <button
              type="button"
              disabled={busy}
              aria-pressed={item.id === activeId}
              onClick={() => {
                if (item.id !== activeId) setSettingsId('');
                onSelect(item.id);
              }}
            >
              {item.title || 'Untitled'}
              {layout.defaultTabId === item.id && <small> {' ' + t('· Default')}</small>}
              {item.hidden && <small> {' ' + t('· Hidden')}</small>}
            </button>
            {item.id === activeId && (
              <button
                ref={settingsButton}
                type="button"
                className="editor-tab-edit"
                disabled={busy}
                aria-label={t('Edit tab {name}', { name: item.title || t('Untitled') })}
                title={t('Edit tab')}
                aria-expanded={settingsId === tab.id}
                aria-controls={settingsId === tab.id ? settingsPanelId : undefined}
                onClick={() => setSettingsId(settingsId === tab.id ? '' : tab.id)}
              >
                <PencilSimpleIcon weight="regular" aria-hidden="true" size={15} />
              </button>
            )}
          </div>
        ))}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="editor-add-tab"
              aria-label={t('Add tab')}
              title={t('Add tab')}
              disabled={busy || layout.tabs.length >= MAX_PROFILE_TABS}
            >
              <PlusIcon weight="regular" aria-hidden="true" size={17} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="add-content-menu"
              align="end"
              sideOffset={8}
              collisionPadding={12}
              aria-label={t('Add a tab')}
            >
              <DropdownMenu.Item
                onSelect={() => {
                  let count = 2;
                  while (layout.tabs.some((tab) => tab.slug === `tab-${count}`)) count++;
                  const id = crypto.randomUUID();
                  onChange({
                    ...layout,
                    tabs: [
                      ...layout.tabs,
                      {
                        id,
                        title: t('Tab {number}', { number: count }),
                        slug: `tab-${count}`,
                        ungrouped: [],
                        sections: [],
                      },
                    ],
                  });
                  setSettingsId(id);
                  onSelect(id);
                }}
              >
                <PlusIcon weight="regular" aria-hidden="true" size={16} />
                <span>
                  <strong>{t('Blank tab')}</strong>
                  <small>{t('Start from scratch')}</small>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item disabled={importBlocked} onSelect={onImport}>
                <UploadSimpleIcon weight="regular" aria-hidden="true" size={16} />
                <span>
                  <strong>{t('Import tab')}</strong>
                  <small>
                    {importBlocked
                      ? t('Save layout and close the editor first')
                      : t('From a wya.im JSON file')}
                  </small>
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </nav>
      {settingsId === tab.id && (
        <div
          id={settingsPanelId}
          className="tab-settings"
          role="region"
          aria-label={t('Settings for {name}', { name: tab.title || t('Untitled') })}
        >
          <label>
            {t('Tab name')}
            <input
              value={tab.title}
              maxLength={30}
              disabled={busy}
              onChange={(event) => update({ title: event.target.value })}
            />
          </label>
          <label>
            {t('Tab URL name')}
            <input
              value={tab.slug}
              maxLength={40}
              disabled={busy}
              onChange={(event) => update({ slug: event.target.value.toLowerCase() })}
              aria-describedby="tab-url-help"
            />
          </label>
          <p id="tab-url-help" className="subtle">
            {t('Share with ?tab=')}
            {tab.slug || 'name'}
            {t(
              '. Use lowercase letters, numbers, and hyphens. Changing this name changes its shared address.',
            )}
          </p>
          <div className="tab-setting-actions">
            <button type="button" className="text-link" disabled={busy} onClick={onExport}>
              <DownloadSimpleIcon weight="regular" aria-hidden="true" size={15} />{' '}
              {' ' + t('Export tab')}
            </button>
            <button
              type="button"
              className="button button-small button-light"
              disabled={busy || layout.defaultTabId === tab.id}
              onClick={() => onChange({ ...layout, defaultTabId: tab.id })}
            >
              {layout.defaultTabId === tab.id ? t('Default tab') : t('Make default')}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Move tab {name} left', { name: tab.title })}
              disabled={busy || index === 0}
              onClick={() => move(-1)}
            >
              <ArrowLeftIcon weight="regular" aria-hidden="true" size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Move tab {name} right', { name: tab.title })}
              disabled={busy || index === layout.tabs.length - 1}
              onClick={() => move(1)}
            >
              <ArrowRightIcon weight="regular" aria-hidden="true" size={18} />
            </button>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={tab.hidden ?? false}
              disabled={busy}
              onChange={(event) => update({ hidden: event.target.checked })}
            />
            {t('Hide this tab')}
          </label>
          <p className="subtle">
            {t('Hides its contents and disables their short links. Save layout to apply.')}
          </p>
          {layout.tabs.length > 1 && (
            <RemoveTabControl
              key={tab.id}
              layout={layout}
              sourceId={tab.id}
              busy={busy}
              onConfirm={(target) => {
                onChange(removeProfileTab(layout, tab.id, target));
                onSelect(target);
              }}
              onReturnFocus={() => settingsButton.current?.focus({ preventScroll: true })}
            />
          )}
        </div>
      )}
    </section>
  );
}
