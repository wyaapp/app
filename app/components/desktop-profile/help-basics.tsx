'use client';

import { useDesktopPreferences } from '@/lib/desktop-preferences';
import { useTranslation } from '../language-provider';

const basics = {
  home: [
    {
      title: 'Select and open',
      text: 'Click or tap once to select an icon. Double-click or double-tap to open it. Start menu, taskbar and sidebar buttons open with one click.',
    },
    {
      title: 'Make room on your Home',
      text: 'Choose Home icon layout in Settings: Automatic keeps icons together, Free positioning lets you place them anywhere, and Snap to grid lets you choose grid slots with gaps. Each mode remembers its arrangement on this device. Small screens use a compact grid.',
    },
    {
      title: 'Choose your own grid slots',
      text: 'Snap to grid is the default. Drop an icon into an empty slot to leave a gap, or onto an occupied slot to swap positions. Dropping a movable document onto a folder still puts it inside. Right-click an icon and choose Arrange icons to fill the gaps again.',
    },
    {
      title: 'Manage your windows',
      text: 'Drag a window by its title bar. Use the top-right buttons to minimize, maximize or close it. Click its taskbar button to bring it back. Show Home minimizes the visible windows.',
    },
    {
      title: 'Keep an app close',
      text: 'Right-click an app or document and choose Pin to taskbar. To restore window and icon positions, open Settings and choose Reset Home.',
    },
  ],
  files: [
    {
      title: 'Find your way around',
      text: 'Open Files to browse folders and files. Open a Markdown file to edit its text, headings, links and widgets. Use the sidebar or breadcrumb path to change folders. Search filters the current folder; the sort menu changes its order.',
    },
    {
      title: 'Create a file',
      text: 'Choose New file for a Markdown or text document, New widget for a standalone block, or New folder to organize them. Upload accepts .md, .txt, and .widget files up to 128 KB each. You can also drop these files into the Files window.',
    },
    {
      title: 'Move and rename',
      text: 'Right-click an item to see its available actions. On touch screens, press and hold. Drag an item into a folder, or choose Move to folder to select its destination. Use Rename for a file or ordinary folder. Properties is available for every file.',
    },
    {
      title: 'File properties',
      text: 'Choose Properties in a file menu to change its name and navigation position, make it the default in Classic view, or unpublish it. Open the file to edit and publish its content.',
    },
    {
      title: 'Upload and download files',
      text: 'Upload a Markdown or text file to create a private draft. Download in the file menu or editor saves the complete source, including its headings, links and widgets.',
    },
    {
      title: 'Delete a file',
      text: 'Open the file and choose Delete. Review the confirmation before removing it. Deleting a published file also removes it from the visitor view.',
    },
    {
      title: 'Put a document on Home',
      text: 'Choose Move to Home in the item menu. Move out of Home returns it to All files. Moving a document does not publish it.',
    },
  ],
  publishing: [
    {
      title: 'Drafts and published files',
      text: 'Editing a file creates unpublished changes. Use Publish changes in its toolbar when it is ready. Until then, visitors keep seeing the published version.',
    },
    {
      title: 'Check the save status',
      text: 'Files save private drafts to your space. If an old page has a draft saved on this device, open its migrated Markdown file to recover it. Check the save status before leaving, and retry if a save fails.',
    },
    {
      title: 'Check the visitor view',
      text: 'Use Preview in the taskbar to see your space as a visitor. Return to editing to make changes. Private documents and unpublished drafts are not shown to visitors.',
    },
    {
      title: 'Review earlier changes',
      text: 'Open Change history from the Start menu to review and restore earlier versions of your profile. File drafts stay private until you publish them.',
    },
  ],
} as const;

export type BasicHelpId = keyof typeof basics;

export function BasicHelp({ guide }: { guide: BasicHelpId }) {
  const { t } = useTranslation();
  return (
    <div className="desktop-help-article">
      {basics[guide].map(({ title, text }) => (
        <section key={title}>
          <h3>{t(title)}</h3>
          <p>{t(text)}</p>
        </section>
      ))}
    </div>
  );
}

export function KeyboardHelp() {
  const { t } = useTranslation();
  const { renameShortcut, iconMode } = useDesktopPreferences();
  const groups = [
    {
      title: 'Getting around',
      rows: [
        ['Tab / Shift + Tab', 'Move focus between controls.'],
        ['Shift + F10', 'Open the selected item menu.'],
        ['Escape', 'Clear the selection or close an open menu.'],
        [renameShortcut, 'Rename a selected document or folder.'],
      ],
    },
    ...(iconMode !== 'auto'
      ? [
          {
            title: 'On Home',
            rows: [
              [
                'Alt + ← ↑ → ↓',
                iconMode === 'grid'
                  ? 'Move the focused icon one grid slot.'
                  : 'Move the focused icon on a wide screen.',
              ],
              ...(iconMode === 'free'
                ? [['Alt + Shift + ← ↑ → ↓', 'Move the focused icon one pixel at a time.']]
                : []),
            ],
          },
        ]
      : []),
    {
      title: 'In Files',
      rows: [
        ['↑ / ↓', 'Select the previous or next item in the list.'],
        ['Alt + ← / →', 'Go back or forward through folders.'],
        ['Ctrl / ⌘ + C', 'Copy a document.'],
        ['Ctrl / ⌘ + X', 'Cut a movable item.'],
        ['Ctrl / ⌘ + V', 'Paste into the current folder.'],
      ],
    },
  ];
  return (
    <div className="desktop-help-article">
      <p>{t('These shortcuts apply outside text fields. Change the rename key in Settings.')}</p>
      {groups.map(({ title, rows }) => (
        <section key={title}>
          <h3>{t(title)}</h3>
          <dl className="desktop-help-shortcuts">
            {rows.map(([keys, description]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{t(description)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
