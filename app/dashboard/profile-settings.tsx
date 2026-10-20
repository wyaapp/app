'use client';
import { useTranslation } from '@/app/components/language-provider';
import { OnboardingForm } from './onboarding-form';
import { Check } from 'lucide-react';
import type { Profile, Revision, SpaceSummary } from '@/lib/profile-types';
import { themeIds, profileThemes } from '@/lib/profile-themes';
import { PictureEditor } from './picture-editor';
import { BioEditor } from './bio-editor';
import { RenameSpace } from './space-controls';
import type { ActiveWorkspace } from './use-workspace';

export function ProfileSettings({ workspace }: { workspace: ActiveWorkspace }) {
  const { t } = useTranslation();
  const { profile, busy, setBusy, setProfile, setSpaces, spaces, setHistory, syncLayout, save } =
    workspace;
  return (
    <>
      <PictureEditor
        key={profile.id}
        profile={profile}
        busy={busy}
        onBusy={setBusy}
        onSaved={(updated) => {
          setProfile(updated);
          setSpaces(
            spaces.map((space) =>
              space.id === updated.id ? { ...space, version: updated.version } : space,
            ),
          );
        }}
        onConflict={async () => {
          const response = await fetch(`/api/account?spaceId=${encodeURIComponent(profile.id)}`);
          if (response.ok) {
            const fresh = (await response.json()) as {
              profile: Profile;
              history: Revision[];
              spaces: SpaceSummary[];
            };
            setProfile(fresh.profile);
            setHistory(fresh.history);
            setSpaces(fresh.spaces);
            syncLayout(fresh.profile);
          }
        }}
      />
      <section className="editor-panel">
        <form
          key={`${profile.id}:${profile.name}:${profile.bio}:${profile.theme}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await save({
              action: 'update_profile',
              name: f.get('name'),
              bio: f.get('bio'),
              theme: f.get('theme'),
            });
          }}
        >
          <label>
            {t('Display name')}
            <input name="name" defaultValue={profile.name} required maxLength={80} />
          </label>
          <BioEditor initial={profile.bio} disabled={busy} />
          <fieldset disabled={busy}>
            <legend>{t('Your color')}</legend>
            <div className="theme-options">
              {themeIds.map((theme) => (
                <label className="theme-choice" key={theme}>
                  <input
                    type="radio"
                    name="theme"
                    value={theme}
                    defaultChecked={profile.theme === theme}
                  />
                  <span aria-hidden="true" style={{ background: profileThemes[theme].color }} />
                  {t(profileThemes[theme].label)}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="button button-dark" disabled={busy}>
            {busy ? t('Saving…') : t('Save profile')}
            <Check size={16} />
          </button>
        </form>
      </section>
      <details className="editor-panel onboarding-settings">
        <summary>{t('About you (optional)')}</summary>
        <p className="subtle">{t('For your account, across all your spaces.')}</p>
        <OnboardingForm
          initial={workspace.onboarding}
          onSaved={workspace.setOnboarding}
          settings
          disabled={busy}
        />
      </details>
      <RenameSpace
        key={`${profile.id}:${profile.handle}`}
        profile={profile}
        busy={busy}
        onSave={save}
      />
    </>
  );
}
