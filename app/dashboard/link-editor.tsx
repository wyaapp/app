'use client';
import { EditorPanel, type EditorPresentation } from './editor-panel';
import { useTranslation } from '@/app/components/language-provider';

import { useRef, useState, type FormEvent } from 'react';
import { useEntryAutosave, EntrySaveStatus, EntryManualActions } from './use-entry-autosave';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';

import {
  linkPresets,
  platforms,
  presetGroups,
  type Platform,
  type LinkIconId,
} from '@/lib/link-options';
import type { LinkItem } from '@/lib/model';
import { parseEmailLink } from '@/lib/email-links';
import {
  getSocialProfile,
  socialDestination,
  supportsSocialUsername,
  isFederatedSocial,
} from '@/lib/social-links';
import { AliasField, parseAliases } from './alias-field';
import { IconPicker } from './icon-picker';

export function LinkEditor({
  link,
  handle,
  existingSlugs,
  busy,
  onSave,
  onClose,
  presentation,
}: {
  handle: string;
  existingSlugs: string[];
  link: LinkItem | 'new';
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
  presentation?: EditorPresentation;
}) {
  const { t } = useTranslation();
  const isNew = link === 'new';
  function availableSlug(value: string) {
    let candidate = value;
    for (let suffix = 2; existingSlugs.includes(candidate); suffix++)
      candidate = `${value}-${suffix}`;
    return candidate;
  }
  const [platform, setPlatform] = useState<Platform>(isNew ? 'website' : link.platform);
  const [slug, setSlug] = useState(isNew ? availableSlug('website') : link.slug);
  const [label, setLabel] = useState(isNew ? t('Website') : link.label);
  const email =
    !isNew && link.platform === 'email'
      ? parseEmailLink(link.url)
      : { address: '', subject: '', body: '' };
  const [aliases, setAliases] = useState(isNew ? '' : (link.aliases?.join(', ') ?? ''));
  const [icon, setIcon] = useState<LinkIconId | ''>(isNew ? '' : (link.icon ?? ''));
  const [destination, setDestination] = useState(
    isNew ? '' : platform === 'email' ? email.address : link.url,
  );
  const [emailSubject, setEmailSubject] = useState(email.subject);
  const [emailBody, setEmailBody] = useState(email.body);
  const [visible, setVisible] = useState(isNew || link.visible);
  const social = getSocialProfile(socialDestination(platform, destination), platform);
  const formRef = useRef<HTMLFormElement>(null);
  const payload = {
    action: 'upsert_link',
    createOnly: isNew,
    slug,
    ...(!isNew ? { originalSlug: link.slug } : {}),
    label,
    aliases: parseAliases(aliases),
    destination,
    ...(platform === 'email' ? { emailSubject, emailBody } : {}),
    platform,
    icon: icon || null,
    visible,
  };
  const autosave = useEntryAutosave({ enabled: !isNew, payload, busy, form: formRef, onSave });
  function choosePreset(value: Platform) {
    if ((value === 'email') !== (platform === 'email')) setDestination('');
    setPlatform(value);
    if (isNew) {
      setSlug(availableSlug(value));
      setLabel(t(linkPresets[value].label));
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (isNew || autosave.manual) {
      if (await onSave(payload)) onClose();
    } else await autosave.flush();
  }
  return (
    <EditorPanel
      presentation={presentation}
      title={isNew ? t('A new place to find you') : t('Edit your link')}
      closeLabel={t('Close link editor')}
      busy={busy}
      onClose={onClose}
    >
      <form ref={formRef} onSubmit={submit}>
        <div className="form-row">
          <label>
            {t('Link preset')}
            <select
              value={platform}
              onChange={(e) => choosePreset(e.target.value as Platform)}
              disabled={busy}
            >
              {presetGroups.map((group) => (
                <optgroup label={t(group)} key={group}>
                  {platforms
                    .filter((p) => linkPresets[p].group === group)
                    .map((p) => (
                      <option value={p} key={p}>
                        {t(linkPresets[p].label)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            {t('URL slug')}
            <input
              name="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.replace(/\s+/g, '-'))}
              required
              maxLength={40}
              pattern={'[A-Za-z0-9](?:[A-Za-z0-9._\\-]{0,38}[A-Za-z0-9])?'}
              disabled={busy}
              aria-describedby="link-url-help"
            />
          </label>
        </div>
        <p className="link-field-help" id="link-url-help">
          {t('Your short URL:')}{' '}
          <strong>
            wya.im/{handle}/{slug.trim().toLowerCase()}
          </strong>
          {!isNew && (
            <span>
              {t('To keep a previous URL working after a rename, add its slug to aliases.')}
            </span>
          )}
        </p>
        <label>
          {t('Display name')}
          <input
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={60}
            disabled={busy}
            aria-describedby="link-label-help"
          />
        </label>
        <p className="link-field-help" id="link-label-help">
          {t('The text people see on your profile. Changing it keeps the same short URL.')}
        </p>
        <AliasField value={aliases} onChange={setAliases} busy={busy} />
        <label>
          {platform === 'email'
            ? t('Email address')
            : isFederatedSocial(platform)
              ? t('Username with server or full URL')
              : platform === 'steam'
                ? t('Custom profile name or full URL')
                : supportsSocialUsername(platform)
                  ? t('Username or full URL')
                  : t('Destination URL')}
          <input
            key={platform === 'email' ? 'email' : 'url'}
            name="destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            disabled={busy}
            placeholder={t(linkPresets[platform].placeholder)}
            required
            maxLength={2048}
            aria-describedby={platform === 'email' ? undefined : 'link-social-help'}
          />
        </label>
        {platform !== 'email' && (
          <p className="link-field-help" id="link-social-help">
            {social
              ? t('Shown below the link name: {username}', { username: social.detail })
              : isFederatedSocial(platform)
                ? t('Use your full address, like @you@server.social, or paste your profile URL.')
                : platform === 'steam'
                  ? t(
                      'Use the name from steamcommunity.com/id/yourname, or paste your profile URL.',
                    )
                  : t('Social profile usernames appear below the link name automatically.')}
          </p>
        )}
        {platform === 'email' && (
          <>
            <label>
              {t('Subject (optional)')}
              <input
                name="emailSubject"
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                maxLength={120}
                disabled={busy}
              />
            </label>
            <label>
              {t('Message (optional)')}
              <textarea
                name="emailBody"
                value={emailBody}
                onChange={(event) => setEmailBody(event.target.value)}
                maxLength={500}
                rows={3}
                disabled={busy}
              />
            </label>
            <p className="link-field-help">
              {t(
                "Opens the visitor's email app. Your address is public while this link is visible.",
              )}
            </p>
          </>
        )}
        <IconPicker value={icon} platform={platform} disabled={busy} onChange={setIcon} />
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="visible"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
            disabled={busy}
          />
          {t('Show on my profile and enable this link')}
        </label>
        {autosave.manual ? (
          <div className="catalog-selection-actions">
            <EntryManualActions busy={busy} onCancel={onClose} />
          </div>
        ) : isNew ? (
          <button className="button button-dark" disabled={busy}>
            {busy ? t('Saving…') : t('Add link')}
            <CheckIcon weight="regular" aria-hidden="true" size={16} />
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
              {t('Done')}
            </button>
          </div>
        )}
      </form>
    </EditorPanel>
  );
}
