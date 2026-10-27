'use client';
import { useTranslation } from '@/app/components/language-provider';
import { OnboardingForm } from './onboarding-form';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
import { BrowserIcon } from '@phosphor-icons/react/dist/ssr/Browser';
import type { Profile, Revision, SpaceSummary } from '@/lib/profile-types';
import { themeIds, profileThemes } from '@/lib/profile-themes';
import { PictureEditor } from './picture-editor';
import { BioEditor } from './bio-editor';
import { RenameSpace } from './space-controls';
import type { ActiveWorkspace } from './use-workspace';

export function ProfileSettings({
  workspace,
  showThemePicker = true,
}: {
  workspace: ActiveWorkspace;
  showThemePicker?: boolean;
}) {
  const { t } = useTranslation();
  const { profile, busy, setBusy, setProfile, setSpaces, spaces, setHistory, save } = workspace;
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
          }
        }}
      />
      <section className="window-section window-section-divider">
        <form
          key={`${profile.id}:${profile.name}:${profile.bio}:${showThemePicker ? profile.theme : ''}:${profile.pageStyle}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await save({
              action: 'update_profile',
              name: f.get('name'),
              bio: f.get('bio'),
              ...(showThemePicker ? { theme: f.get('theme') } : {}),
              pageStyle: f.get('pageStyle'),
            });
          }}
        >
          <label>
            {t('Display name')}
            <input name="name" defaultValue={profile.name} required maxLength={80} />
          </label>
          <BioEditor initial={profile.bio} disabled={busy} />
          <fieldset disabled={busy}>
            <legend>{t('Page style')}</legend>
            <div className="page-style-options">
              {[
                {
                  value: 'classic',
                  label: 'Classic',
                  detail: 'Your profile in one scroll.',
                  Icon: BrowserIcon,
                },
                {
                  value: 'desktop',
                  label: 'Home',
                  detail: 'Your tabs become windows in Home.',
                  Icon: HouseIcon,
                },
              ].map(({ value, label, detail, Icon }) => (
                <label className="page-style-choice" key={value}>
                  <input
                    type="radio"
                    name="pageStyle"
                    value={value}
                    defaultChecked={(profile.pageStyle ?? 'classic') === value}
                  />
                  <Icon
                    weight={value === 'desktop' ? 'duotone' : 'regular'}
                    size={26}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{t(label)}</strong>
                    <small>{t(detail)}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {showThemePicker && (
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
          )}
          <button className="button button-dark" disabled={busy}>
            {busy ? t('Saving…') : t('Save Bio')}
            <CheckIcon weight="regular" aria-hidden="true" size={16} />
          </button>
        </form>
      </section>
      <details className="window-section window-section-divider onboarding-settings">
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
