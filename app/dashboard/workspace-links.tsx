import { Copy, Check } from 'lucide-react';
import { allItems } from '@/lib/collections';
import {
  applyProfileLayout,
  reconcileProfileLayout,
  moveItemToTab,
  moveSectionToTab,
} from '@/lib/profile-tabs';
import { exportTab, TAB_FILE_LIMIT } from '@/lib/tab-transfer';
import { ItemEditor } from './item-editor';
import { TabImport } from './tab-import';
import { ProfileTabEditor } from './profile-tab-editor';
import { LayoutEditor } from './layout-editor';
import { RemoveItemDialog } from './remove-item-dialog';
import type { ActiveWorkspace } from './use-workspace';

export function WorkspaceLinks({ workspace }: { workspace: ActiveWorkspace }) {
  const {
    profile,
    busy,
    autosaving,
    editing,
    deleting,
    error,
    setError,
    setDeleting,
    latestProfile,
    profileLayout,
    activeProfileTab,
    layout,
    newProfileTab,
    previewProfile,
    layoutChanged,
    layoutInvalid,
    save,
    copyLink,
    closeEditor,
    changeProfileLayout,
    selectProfileTab,
    finishEntry,
    changeLayout,
    edit,
    requestDelete,
    registerAutosave,
    discardLayout,
    deleteTrigger,
    addLinkButton,
  } = workspace;
  return (
    <>
      <div className="workspace-address">
        <span>wya.im/{profile.handle}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Copy profile link"
          title="Copy profile link"
          onClick={copyLink}
        >
          <Copy size={14} />
        </button>
      </div>
      {typeof editing === 'string' && (
        <ItemEditor
          key={editing}
          item={editing}
          handle={profile.handle}
          existingSlugs={allItems(profile.links).flatMap((link) => [
            link.slug,
            ...(link.aliases ?? []),
          ])}
          busy={busy}
          onSave={save}
          onClose={closeEditor}
        />
      )}
      <TabImport
        key={profile.id}
        profile={profile}
        busy={busy}
        blocked={layoutChanged || !!editing}
        onImport={(file) => save({ action: 'import_tab', file })}
      >
        {(openImport) => (
          <ProfileTabEditor
            onImport={openImport}
            importBlocked={layoutChanged || !!editing}
            layout={profileLayout}
            activeId={activeProfileTab.id}
            busy={busy}
            onChange={changeProfileLayout}
            onSelect={selectProfileTab}
            onExport={async () => {
              if (!(await finishEntry())) return;
              try {
                const current = latestProfile.current!;
                const data = JSON.stringify(
                  exportTab(
                    applyProfileLayout(current, reconcileProfileLayout(profileLayout, current)),
                    activeProfileTab.id,
                  ),
                  null,
                  2,
                );
                const blob = new Blob([data], { type: 'application/json' });
                if (blob.size > TAB_FILE_LIMIT)
                  throw new Error('This tab exceeds the 1 MB export limit.');
                const url = URL.createObjectURL(blob),
                  anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `wya-${activeProfileTab.slug}.json`;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Could not export tab.');
              }
            }}
          />
        )}
      </TabImport>
      {layoutInvalid && (
        <p className="message error" role="status">
          Give every tab and section a name. Tab URL names must be unique and use lowercase letters,
          numbers, and hyphens.
        </p>
      )}
      {newProfileTab && (
        <p className="tab-draft-hint" role="status">
          Save layout to create this tab before adding new items. You can move existing items here
          now.
        </p>
      )}
      <LayoutEditor
        key={`${profile.id}:${activeProfileTab.id}`}
        tabs={profileLayout.tabs}
        activeTabId={activeProfileTab.id}
        onTabAssign={(slug, target) =>
          changeProfileLayout(moveItemToTab(profileLayout, slug, target))
        }
        onSectionTabAssign={(sectionId, target) =>
          changeProfileLayout(moveSectionToTab(profileLayout, sectionId, target))
        }
        layout={layout}
        links={previewProfile!.links}
        handle={profile.handle}
        busy={busy}
        onChange={changeLayout}
        onEdit={edit}
        onDelete={requestDelete}
        editingSlug={typeof editing === 'object' ? editing?.slug : undefined}
        renderEditor={() =>
          editing && typeof editing === 'object' ? (
            <>
              {error && (
                <p className="message error" role="alert">
                  {error}
                </p>
              )}
              <ItemEditor
                registerAutosave={registerAutosave}
                item={editing}
                handle={profile.handle}
                existingSlugs={allItems(profile.links).flatMap((link) => [
                  link.slug,
                  ...(link.aliases ?? []),
                ])}
                busy={busy && !autosaving}
                onSave={(data) => save(data, true)}
                onClose={closeEditor}
              />
            </>
          ) : null
        }
      />
      {layoutChanged && (
        <div className="order-save-bar">
          <span role="status">Unsaved layout</span>
          <div>
            <button
              className="button button-light button-small"
              disabled={busy}
              onClick={() => {
                discardLayout(profile.id);
                setError('');
              }}
            >
              Discard
            </button>
            <button
              className="button button-dark button-small"
              disabled={busy || layoutInvalid}
              onClick={() => void save({ action: 'set_tabs', ...profileLayout })}
            >
              {busy ? 'Saving…' : 'Save layout'}
              <Check size={16} />
            </button>
          </div>
        </div>
      )}
      {profile.links.length === 0 && !editing && !newProfileTab && (
        <div className="empty-state">
          <span>↗</span>
          <h2>Start with your favorite corner.</h2>
          <p>Use Add above to share a link, project, game, or Game Collection.</p>
        </div>
      )}
      <RemoveItemDialog
        item={deleting}
        busy={busy}
        error={error}
        hasLayoutDraft={layoutChanged}
        onCancel={() => {
          setDeleting(null);
          setError('');
        }}
        onConfirm={async () => {
          if (deleting && (await save({ action: 'delete_link', slug: deleting.slug })))
            setDeleting(null);
        }}
        onReturnFocus={() => {
          const target = deleteTrigger.current?.isConnected
            ? deleteTrigger.current
            : addLinkButton.current;
          target?.focus({ preventScroll: true });
        }}
      />
    </>
  );
}
