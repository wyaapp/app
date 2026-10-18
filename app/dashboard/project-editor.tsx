'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useEntryAutosave, EntrySaveStatus } from './use-entry-autosave';
import { Check, X } from 'lucide-react';
import type { LinkItem } from '@/lib/model';
import { IconPicker } from './icon-picker';
import type { LinkIconId } from '@/lib/link-options';
import { ItemButtonsEditor } from './item-buttons-editor';
import { AliasField, parseAliases } from './alias-field';

export function ProjectEditor({
  project,
  handle,
  existingSlugs,
  busy,
  onSave,
  onClose,
}: {
  project: LinkItem | 'new';
  handle: string;
  existingSlugs: string[];
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const isNew = project === 'new';
  let available = 'project';
  for (let i = 2; existingSlugs.includes(available); i++) available = `project-${i}`;
  const [icon, setIcon] = useState<LinkIconId | ''>(isNew ? '' : (project.icon ?? ''));
  const [slug, setSlug] = useState(isNew ? available : project.slug);
  const [aliases, setAliases] = useState(isNew ? '' : (project.aliases?.join(', ') ?? ''));
  const [buttons, setButtons] = useState(
    isNew
      ? [{ label: 'Live demo', destination: '' }]
      : project.project!.buttons.map((button) => ({
          label: button.label,
          destination: button.url,
        })),
  );
  const [label, setLabel] = useState(isNew ? '' : project.label);
  const [description, setDescription] = useState(isNew ? '' : project.project!.description);
  const [coverUrl, setCoverUrl] = useState(isNew ? '' : (project.project!.coverUrl ?? ''));
  const [visible, setVisible] = useState(!isNew && project.visible);
  const formRef = useRef<HTMLFormElement>(null);
  const payload = {
    action: 'upsert_project',
    createOnly: isNew,
    slug,
    ...(!isNew ? { originalSlug: project.slug } : {}),
    aliases: parseAliases(aliases),
    label,
    description,
    coverUrl: coverUrl || null,
    icon: icon || null,
    buttons,
    visible,
  };
  const autosave = useEntryAutosave({ enabled: !isNew, payload, busy, form: formRef, onSave });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (isNew) {
      if (await onSave(payload)) onClose();
    } else await autosave.flush();
  }
  return (
    <section className="editor-panel">
      <div className="panel-heading">
        <h2>{isNew ? 'Showcase a project' : 'Edit your project'}</h2>
        <button
          className="icon-button"
          aria-label="Close project editor"
          onClick={onClose}
          disabled={busy}
        >
          <X size={18} />
        </button>
      </div>
      <form ref={formRef} onSubmit={submit}>
        <label>
          Project title
          <input
            name="title"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            maxLength={60}
            disabled={busy}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            maxLength={800}
            rows={4}
            disabled={busy}
            placeholder="What did you make, and what makes it worth exploring?"
          />
        </label>
        <IconPicker
          value={icon}
          platform="portfolio"
          itemType="project"
          disabled={busy}
          onChange={setIcon}
        />
        <p className="link-field-help">
          Your icon appears when there&apos;s no thumbnail, or if the image can&apos;t load.
        </p>
        <label>
          Thumbnail image URL (optional)
          <input
            name="coverUrl"
            type="url"
            value={coverUrl}
            onChange={(event) => setCoverUrl(event.target.value)}
            maxLength={2048}
            disabled={busy}
            placeholder="https://your-site.com/project-thumbnail.webp"
          />
          <span className="field-description">
            A hosted HTTPS image, cropped to a small square beside your project. Uploads aren&apos;t
            available for project images yet.
          </span>
        </label>
        <label>
          URL slug
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value.replace(/\s+/g, '-'))}
            required
            maxLength={40}
            pattern="[A-Za-z0-9](?:[A-Za-z0-9._\-]{0,38}[A-Za-z0-9])?"
            disabled={busy}
          />
          <span className="field-description">
            wya.im/{handle}/{slug.trim().toLowerCase()} opens the first button&apos;s destination.
          </span>
        </label>
        {!isNew && (
          <p className="link-field-help">
            To keep a previous URL working after a rename, add its slug to aliases.
          </p>
        )}
        <AliasField value={aliases} onChange={setAliases} busy={busy} />
        <ItemButtonsEditor
          buttons={buttons}
          onChange={setButtons}
          busy={busy}
          label="Project buttons"
          hint="Up to three destinations, such as Live demo, Source code, or Case study."
          minButtons={1}
          newLabel="Source code"
        />
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="visible"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
            disabled={busy}
          />
          Show project on my profile and enable its short URLs
        </label>
        {isNew && (
          <p className="link-field-help">
            New projects start hidden. You can save your work before making it visible.
          </p>
        )}
        {isNew ? (
          <button className="button button-dark" disabled={busy}>
            {busy ? 'Saving…' : 'Add project'}
            <Check size={16} />
          </button>
        ) : (
          <div className="catalog-selection-actions">
            <EntrySaveStatus
              status={autosave.status}
              onRetry={() => void autosave.flush()}
              onDiscard={() => {
                if (autosave.discard()) onClose();
              }}
            />
            <button type="button" className="text-link" disabled={busy} onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
