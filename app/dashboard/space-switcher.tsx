import { CaretUpDownIcon } from '@phosphor-icons/react/dist/ssr/CaretUpDown';
import { useTranslation } from '../components/language-provider';
import type { ActiveWorkspace } from './use-workspace';
import { canExplorePremium, spaceLimitReached } from './space-plan-summary';

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
  const atLimit = spaceLimitReached(workspace.plan, spaces.length);
  const upgrade = atLimit && canExplorePremium(workspace.plan);

  return (
    <label className="workspace-space-switcher">
      <span className="workspace-space-label">
        {t('Editing space')} ·{' '}
        {workspace.plan.spaceLimit === null
          ? t('No space limit')
          : `${spaces.length}/${workspace.plan.spaceLimit}`}
      </span>
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
          if (value === '__explore_premium__') {
            await workspace.selectSection('billing');
          } else if (value === '__new_space__') {
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
        <option
          value={upgrade ? '__explore_premium__' : '__new_space__'}
          disabled={atLimit && !upgrade}
        >
          {upgrade ? t('Explore Premium') : t('＋ Create a space')}
          {atLimit && !upgrade ? ` ${t('(limit reached)')}` : ''}
        </option>
      </select>
    </label>
  );
}
