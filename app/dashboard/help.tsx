'use client';

import { useTranslation } from '../components/language-provider';
import { ChatGPTPanel } from './chatgpt-panel';
import { DiscordSetupSteps } from './discord-setup-guide';

const guides = [
  [
    'Files',
    'Open a file to edit its content. Create Markdown pages, plain text files, or a widget containing a single block.',
  ],
  [
    'Save and publish',
    'Edits stay in a local draft until you save. Publish when you want visitors to see your changes.',
  ],
  [
    'Page layout',
    'Choose which published files appear on your page and arrange their order. Visitors see one scrollable column on every screen size.',
  ],
  [
    'Trash',
    'Deleted files and folders go to Trash. You can restore them as private drafts or permanently delete them.',
  ],
];

export default function Help({ standalone, handle }: { standalone: boolean; handle: string }) {
  const { t } = useTranslation();
  return (
    <div className="dashboard-help">
      {guides.map(([title, description]) => (
        <section className="panel-section panel-section-divider" key={title}>
          <h2>{t(title)}</h2>
          <p>{t(description)}</p>
        </section>
      ))}
      <details className="panel-section panel-section-divider">
        <summary>{t('Use ChatGPT')}</summary>
        <ChatGPTPanel standalone={standalone} handle={handle} embedded />
      </details>
      <details className="panel-section panel-section-divider">
        <summary>{t('Discord widget')}</summary>
        <DiscordSetupSteps context="help" />
      </details>
    </div>
  );
}
