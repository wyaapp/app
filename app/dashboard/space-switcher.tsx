import { CaretUpDownIcon } from '@phosphor-icons/react/dist/ssr/CaretUpDown';
import { useTranslation } from '../components/language-provider';
import { MAX_SPACES } from '@/lib/profile-types';
import type { ActiveWorkspace } from './use-workspace';

export function SpaceSwitcher({ workspace }: { workspace: ActiveWorkspace }) {
  const { t } = useTranslation();
  const {
    profile,
    spaces,
    busy,
    autosaving,
    finishEntry,
    selectSpace,
    setCreating,
    setError,
    setNotice,
  } = workspace;

  return (
    <label className="workspace-space-switcher">
      <span className="workspace-space-label">{t('Editing space')}</span>
      <span className="workspace-space-current" aria-hidden="true">
        <strong>{profile.name}</strong>
        <span>@{profile.handle}</span>
      </span>
      <CaretUpDownIcon weight="regular" size={18} aria-hidden="true" />
      <select
        aria-label={t('Editing space')}
        value={profile.id}
        disabled={busy && !autosaving}
        title={`${profile.name} · @${profile.handle}`}
        onChange={async (event) => {
          const value = event.target.value;
          if (value === '__new_space__') {
            if (!(await finishEntry())) return;
            setCreating(true);
            setError('');
            setNotice('');
          } else void selectSpace(value);
        }}
      >
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name} · @{space.handle}
          </option>
        ))}
        <option value="__new_space__" disabled={spaces.length >= MAX_SPACES}>
          {t('＋ Create a space')}
          {spaces.length >= MAX_SPACES ? ` ${t('(limit reached)')}` : ''}
        </option>
      </select>
    </label>
  );
}
