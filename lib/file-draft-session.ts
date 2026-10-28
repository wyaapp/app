import {
  fileActionSchema,
  fileNameSchema,
  type FileAction,
  type SpaceFile,
} from './space-files.ts';
import {
  normalizeDocumentAppearance,
  sameDocumentAppearance,
  type DocumentAppearance,
} from './document-appearance.ts';

export type FileDraftValue = {
  name: string;
  content: string;
  appearance: DocumentAppearance;
};
type ChangeFile = (action: FileAction) => Promise<SpaceFile | undefined>;
type ManagementAction = 'publish' | 'unpublish' | 'pin' | 'delete' | 'move';
const conflictMessage =
  'This file changed elsewhere. Download your changes or reload the page to recover your local draft.';

function valueOf(file: Pick<SpaceFile, 'name' | 'content' | 'appearance'>): FileDraftValue {
  return {
    name: file.name,
    content: file.content,
    appearance: normalizeDocumentAppearance(file.appearance),
  };
}

/** Local editing and explicit server writes have separate lifetimes. No timers or background drain. */
export class FileDraftSession {
  draft: FileDraftValue;
  saved: SpaceFile;
  error = '';
  private change: ChangeFile;
  private listeners = new Set<() => void>();
  private running: { key: string; promise: Promise<boolean> } | null = null;
  private conflicting = false;
  private deferredFile: SpaceFile | null = null;

  constructor(file: SpaceFile, change: ChangeFile) {
    this.saved = file;
    this.draft = valueOf(file);
    this.change = change;
  }

  get dirty() {
    return (
      this.draft.name.trim() !== this.saved.name ||
      this.draft.content !== this.saved.content ||
      !sameDocumentAppearance(this.draft.appearance, this.saved.appearance)
    );
  }

  get saving() {
    return this.running !== null;
  }

  configure(change: ChangeFile) {
    this.change = change;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  edit(value: Partial<FileDraftValue>) {
    const next = valueOf({ ...this.draft, ...value });
    if (
      next.name === this.draft.name &&
      next.content === this.draft.content &&
      sameDocumentAppearance(next.appearance, this.draft.appearance)
    )
      return;
    this.draft = next;
    if (!this.conflicting) this.error = '';
    this.notify();
  }

  /** Adopt metadata updates, without replacing fields the user has edited locally. */
  accept(file: SpaceFile) {
    if (file.id !== this.saved.id || file.version <= this.saved.version) return;
    // React may deliver our own response through props before change() resolves.
    // Let the explicit write acknowledge its snapshot before comparing external changes.
    if (this.running) {
      if (!this.deferredFile || file.version > this.deferredFile.version) this.deferredFile = file;
      return;
    }
    this.receiveExternal(file);
    this.notify();
  }

  private receiveExternal(file: SpaceFile) {
    if (this.conflicting || file.id !== this.saved.id || file.version <= this.saved.version) return;
    const overlaps = (local: string, remote: string, base: string) =>
      local !== base && remote !== base && local !== remote;
    if (
      overlaps(this.draft.name, file.name, this.saved.name) ||
      overlaps(this.draft.content, file.content, this.saved.content) ||
      (!sameDocumentAppearance(this.draft.appearance, this.saved.appearance) &&
        !sameDocumentAppearance(file.appearance, this.saved.appearance) &&
        !sameDocumentAppearance(this.draft.appearance, file.appearance))
    ) {
      this.conflicting = true;
      this.error = conflictMessage;
      return;
    }
    this.adopt(file, valueOf(this.saved));
  }

  private acceptDeferred() {
    const deferred = this.deferredFile;
    this.deferredFile = null;
    if (deferred) this.receiveExternal(deferred);
  }

  private adopt(file: SpaceFile, baseline: FileDraftValue) {
    if (file.version < this.saved.version) return;
    this.draft = {
      name: this.draft.name === baseline.name ? file.name : this.draft.name,
      content: this.draft.content === baseline.content ? file.content : this.draft.content,
      appearance: sameDocumentAppearance(this.draft.appearance, baseline.appearance)
        ? normalizeDocumentAppearance(file.appearance)
        : this.draft.appearance,
    };
    this.saved = file;
  }

  private run(key: string, operation: () => Promise<boolean>): Promise<boolean> {
    if (this.conflicting) return Promise.resolve(false);
    if (this.running)
      return this.running.key === key ? this.running.promise : Promise.resolve(false);
    this.error = '';
    const promise = Promise.resolve()
      .then(operation)
      .catch((cause: unknown) => {
        this.error =
          cause instanceof Error ? cause.message : 'Could not save this file. Please try again.';
        return false;
      })
      .then((success) => {
        this.running = null;
        this.acceptDeferred();
        this.notify();
        return success && !this.conflicting;
      });
    this.running = { key, promise };
    this.notify();
    return promise;
  }

  private async writeSnapshot(snapshot: FileDraftValue) {
    const parsed = fileActionSchema.safeParse({
      action: 'save',
      id: this.saved.id,
      version: this.saved.version,
      ...snapshot,
    });
    if (!parsed.success)
      throw new Error('Use a valid .md, .txt or .widget filename and plain text up to 128 KB.');
    const next = await this.change(parsed.data);
    if (!next || next.id !== this.saved.id)
      throw new Error('Could not confirm the save. Your changes are still in this window.');
    if (next.version < this.saved.version)
      throw new Error('This file changed elsewhere. Reload before saving.');
    this.adopt(next, snapshot);
  }

  save(): Promise<boolean> {
    if (this.conflicting) return Promise.resolve(false);
    if (this.running)
      return this.running.key === 'save' ? this.running.promise : Promise.resolve(false);
    if (!this.dirty) return Promise.resolve(true);
    const snapshot = valueOf(this.draft);
    return this.run('save', async () => {
      await this.writeSnapshot(snapshot);
      return !this.dirty;
    });
  }

  manage(action: ManagementAction, folderId?: string | null): Promise<boolean> {
    if (this.conflicting) return Promise.resolve(false);
    const destination = folderId ?? null;
    const key = action === 'move' ? `move:${destination}` : action;
    if (this.running)
      return this.running.key === key ? this.running.promise : Promise.resolve(false);
    if (action === 'move' && this.saved.folderId === destination) return Promise.resolve(true);
    if (action === 'unpublish' && !this.saved.published) return Promise.resolve(true);
    if (action === 'publish' && this.saved.published && !this.saved.hasChanges && !this.dirty)
      return Promise.resolve(true);
    const snapshot = valueOf(this.draft);
    const needsSave = this.dirty;
    return this.run(key, async () => {
      // Trash retains the explicit action's current draft. Other metadata changes never save it.
      if ((action === 'publish' || action === 'delete') && needsSave) {
        await this.writeSnapshot(snapshot);
        if (this.dirty) {
          this.error = 'Newer changes are still unsaved. Save them before continuing.';
          return false;
        }
      }
      const baseline = valueOf(this.saved);
      const next = await this.change({
        action,
        id: this.saved.id,
        version: this.saved.version,
        ...(action === 'pin' ? { pinned: !this.saved.pinned } : {}),
        ...(action === 'move' ? { folderId: destination } : {}),
      } as FileAction);
      if (next) this.adopt(next, baseline);
      else if (action !== 'delete')
        throw new Error('Could not confirm the save. Your changes are still in this window.');
      return true;
    });
  }

  rename(name: string): Promise<boolean> {
    if (this.conflicting) return Promise.resolve(false);
    const parsed = fileNameSchema.safeParse(name);
    if (!parsed.success) {
      this.error = 'Use a .md, .txt or .widget filename without folders.';
      this.notify();
      return Promise.resolve(false);
    }
    const key = `rename:${parsed.data}`;
    if (this.running)
      return this.running.key === key ? this.running.promise : Promise.resolve(false);
    if (parsed.data === this.saved.name) return Promise.resolve(true);
    const previousName = this.draft.name;
    this.draft = { ...this.draft, name: parsed.data };
    return this.run(key, async () => {
      try {
        // Renaming sends only persisted content; pending edits remain a local draft.
        await this.writeSnapshot({ ...valueOf(this.saved), name: parsed.data });
        return true;
      } catch (cause) {
        if (this.draft.name === parsed.data) this.draft = { ...this.draft, name: previousName };
        throw cause;
      }
    });
  }
}
