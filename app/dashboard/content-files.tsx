'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import { useTranslation } from '../components/language-provider';
import { useFiles } from '../components/files/use-files';
import { FileTrashView } from '../components/files/trash-view';
import { decodeTextFile, MAX_FILE_BYTES, MAX_SPACE_FILES } from '@/lib/space-files';
import type { ActiveWorkspace } from './use-workspace';
import type { RegisterNavigationGuard } from '@/lib/navigation-guard';

const TextEditor = lazy(() =>
  import('../components/files/text-editor').then((module) => ({
    default: module.TextEditor,
  })),
);
export default function ContentFiles({
  workspace,
  registerGuard,
}: {
  workspace: ActiveWorkspace;
  registerGuard: RegisterNavigationGuard;
}) {
  const { t } = useTranslation();
  const files = useFiles(workspace.profile.id, workspace.refreshFiles);
  const [opened, setOpened] = useState<string | null>(null);
  const [folder, setFolder] = useState('all');
  const [search, setSearch] = useState('');
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<'file' | 'folder' | null>(null);
  const [name, setName] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const requests = useRef(0);
  const blockGuards = useRef(new Map<string, () => Promise<boolean>>());
  const registerBlockGuard = useCallback<RegisterNavigationGuard>((id, guard) => {
    blockGuards.current.set(id, guard);
    return () => {
      blockGuards.current.delete(id);
    };
  }, []);
  const checkpointAll = files.checkpointAll;
  const checkpoint = useCallback(async () => {
    for (const guard of blockGuards.current.values()) if (!(await guard())) return false;
    return checkpointAll();
  }, [checkpointAll]);
  useEffect(
    () => registerGuard('files', async () => !busy && checkpoint()),
    [registerGuard, busy, checkpoint],
  );
  useEffect(
    () => () => {
      requests.current++;
    },
    [],
  );
  const file = files.documents.find(
    (file) => file.id === opened && files.files.some((item) => item.id === file.id),
  );
  const shown = files.files
    .filter(
      (file) =>
        (folder === 'all' || (folder === 'root' ? !file.folderId : file.folderId === folder)) &&
        file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const folderId = folder === 'all' || folder === 'root' ? null : folder;
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your changes.');
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const request = ++requests.current;
    if (!(await checkpoint())) return;
    setBusy(true);
    try {
      if ((await files.open(id)) && request === requests.current) setOpened(id);
    } finally {
      if (request === requests.current) setBusy(false);
    }
  }
  async function back() {
    if (!busy && (await checkpoint())) setOpened(null);
  }
  async function createWidget(content: string) {
    const existing = new Set(files.files.map((file) => file.name.toLowerCase()));
    let name = 'Untitled.widget';
    for (let i = 2; existing.has(name.toLowerCase()); i++) name = `Untitled (${i}).widget`;
    await files.change({ action: 'create', name, content, folderId });
    setNotice('File created.');
  }
  return (
    <section className="content-files" aria-busy={busy || files.loading}>
      {(error || files.error) && (
        <p role="alert" className="dashboard-message error">
          {t(error || files.error)}
        </p>
      )}
      {notice && (
        <p role="status" className="dashboard-message">
          {t(notice)}
        </p>
      )}
      {file ? (
        <>
          <div className="content-toolbar">
            <button type="button" className="text-link" onClick={() => void back()} disabled={busy}>
              <ArrowLeftIcon size={18} />
              {t('Files')}
            </button>
            <h2>{file.name}</h2>
          </div>
          <Suspense
            fallback={
              <p className="dashboard-panel" role="status">
                {t('Loading…')}
              </p>
            }
          >
            <TextEditor
              key={file.id}
              file={file}
              files={files}
              profile={workspace.profile}
              registerGuard={registerBlockGuard}
              onCreateWidget={createWidget}
            />
          </Suspense>
        </>
      ) : (
        <>
          <div className="content-toolbar">
            <button
              className="button button-small"
              type="button"
              disabled={busy || files.loading || files.files.length >= MAX_SPACE_FILES}
              onClick={() => {
                setTrash(false);
                setForm('file');
                setName('Untitled.md');
              }}
            >
              {t('New file')}
              <PlusIcon size={18} />
            </button>
            <button
              className="text-link"
              type="button"
              disabled={busy || files.loading}
              onClick={() => upload.current?.click()}
            >
              <UploadSimpleIcon size={18} />
              {t('Upload')}
            </button>
            <button
              className="text-link"
              type="button"
              disabled={busy || files.loading}
              onClick={() => {
                setTrash(false);
                setForm('folder');
                setName('');
              }}
            >
              {t('New folder')}
            </button>
            <button
              className="text-link content-trash-button"
              type="button"
              disabled={busy}
              aria-pressed={trash}
              onClick={() => {
                setTrash(!trash);
                setForm(null);
                if (!trash) void files.loadTrash();
              }}
            >
              {t(trash ? 'All files' : 'Trash')}
            </button>
            <input
              ref={upload}
              type="file"
              multiple
              hidden
              accept=".md,.txt,.widget"
              onChange={(event) => {
                const selected = [...(event.target.files ?? [])];
                event.target.value = '';
                void run(async () => {
                  if (selected.length + files.files.length > MAX_SPACE_FILES)
                    throw new Error('This space has reached its 30-file limit.');
                  const imports = await Promise.all(
                    selected.map(async (item) => {
                      if (item.size > MAX_FILE_BYTES)
                        throw new Error('Choose a .md, .txt, or .widget file, up to 128 KB.');
                      return {
                        name: item.name,
                        content: decodeTextFile(item.name, await item.arrayBuffer()),
                      };
                    }),
                  );
                  for (const item of imports)
                    await files.change({ action: 'create', ...item, folderId });
                  setTrash(false);
                  setNotice('Files added as private drafts.');
                });
              }}
            />
          </div>
          {form && (
            <form
              className="content-create dashboard-panel"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  if (form === 'folder') {
                    await files.changeFolder({ action: 'create-folder', name, parentId: folderId });
                  } else {
                    const result = await files.change({
                      action: 'create',
                      name,
                      content: '',
                      folderId,
                    });
                    if (result && (await files.open(result.id))) setOpened(result.id);
                  }
                  setForm(null);
                  setName('');
                });
              }}
            >
              <label>
                {t(form === 'file' ? 'File name' : 'Folder name')}
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={form === 'file' ? 'Untitled.md' : t('Folder name')}
                />
              </label>
              {form === 'file' && (
                <p className="subtle">{t('Uploads: .md, .txt, .widget · Up to 128 KB each')}</p>
              )}
              <div className="content-actions">
                <button className="button button-small" disabled={busy}>
                  {t(busy ? 'Saving…' : 'Create')}
                </button>
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  {t('Cancel')}
                </button>
              </div>
            </form>
          )}
          <div className="content-filters">
            <label>
              {t('Search')}
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {!trash && (
              <label>
                {t('Folder')}
                <select
                  value={folder}
                  disabled={busy}
                  onChange={(event) => setFolder(event.target.value)}
                >
                  <option value="all">{t('All files')}</option>
                  <option value="root">{t('Root folder')}</option>
                  {files.folders.map((folder) => (
                    <option value={folder.id} key={folder.id}>
                      {folder.system === 'desktop' ? t('Home') : folder.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {trash ? (
            <FileTrashView
              entries={files.trash}
              loading={files.trashLoading}
              loadError={files.trashError}
              search={search}
              busy={busy}
              setBusy={setBusy}
              onRefresh={files.loadTrash}
              onRestore={files.restoreTrash}
              onPurge={files.purgeTrash}
              onEmpty={files.emptyTrash}
              onNotice={setNotice}
              renderLayout={(toolbar, content) => (
                <>
                  {toolbar}
                  {content}
                </>
              )}
            />
          ) : (
            <>
              {files.loading ? (
                <p className="dashboard-panel" role="status">
                  {t('Loading…')}
                </p>
              ) : shown.length ? (
                <ul className="content-file-list">
                  {shown.map((file) => (
                    <li key={file.id}>
                      <button
                        className="content-file-open"
                        type="button"
                        disabled={busy}
                        onClick={() => void open(file.id)}
                      >
                        <FileTextIcon size={26} weight="duotone" aria-hidden="true" />
                        <span>
                          <strong>{file.name}</strong>
                          <small>
                            {Math.max(1, Math.ceil(file.size / 1024))} KB
                            {file.folderId &&
                              ` · ${files.folders.find((folder) => folder.id === file.folderId)?.name ?? ''}`}
                          </small>
                        </span>
                        <span className="content-file-status">
                          {t(
                            file.published
                              ? file.hasChanges
                                ? 'Unpublished changes'
                                : 'Published'
                              : 'Private draft',
                          )}
                        </span>
                      </button>
                      <details className="content-file-actions">
                        <summary>{t('Actions')}</summary>
                        <div>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const name = String(
                                new FormData(event.currentTarget).get('name') ?? '',
                              ).trim();
                              if (name && name !== file.name)
                                void run(async () => {
                                  await files.rename(file, name);
                                });
                            }}
                          >
                            <label>
                              {t('File name')}
                              <input
                                name="name"
                                defaultValue={file.name}
                                key={file.name}
                                disabled={busy}
                                required
                              />
                            </label>
                            <button className="button button-light button-small" disabled={busy}>
                              {t('Rename')}
                            </button>
                          </form>
                          <label>
                            {t('Move to')}
                            <select
                              aria-label={t('Move to')}
                              value={file.folderId ?? ''}
                              disabled={busy}
                              onChange={(event) => {
                                const destination = event.target.value || null;
                                void run(() => files.move(file, destination));
                              }}
                            >
                              <option value="">{t('Root folder')}</option>
                              {files.folders.map((folder) => (
                                <option value={folder.id} key={folder.id}>
                                  {folder.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="text-link"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t(
                                    'Move "{name}" to Trash? It will no longer be visible to visitors.',
                                    { name: file.name },
                                  ),
                                )
                              )
                                void run(() => files.deleteFile(file));
                            }}
                          >
                            {t('Move to Trash')}
                          </button>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-panel">{t('No files found.')}</p>
              )}
              {folderId && (
                <div className="content-toolbar">
                  <span>{files.folders.find((item) => item.id === folderId)?.name}</span>
                  {!files.folders.find((item) => item.id === folderId)?.system && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => {
                        const target = files.folders.find((item) => item.id === folderId);
                        if (
                          target &&
                          window.confirm(
                            t(
                              'Move "{name}" and everything inside it to Trash? Published content will be removed from your space.',
                              { name: target.name },
                            ),
                          )
                        )
                          void run(async () => {
                            await files.deleteFolder(target);
                            setFolder('all');
                          });
                      }}
                    >
                      {t('Move to Trash')}
                    </button>
                  )}
                </div>
              )}
              <footer className="content-toolbar">
                <span>{t('{count} files', { count: files.files.length })}</span>
                <span className="subtle">
                  {t('Uploads: .md, .txt, .widget · Up to 128 KB each')}
                </span>
              </footer>
            </>
          )}
        </>
      )}
    </section>
  );
}
