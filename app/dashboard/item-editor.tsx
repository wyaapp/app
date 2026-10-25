'use client';
import {
  EntryAutosaveContext,
  EntrySaveModeContext,
  EntryManualDirtyContext,
  EntryDiscardConfirmationContext,
  type EntryDiscardConfirmation,
  type FlushEntry,
} from './use-entry-autosave';
import { CollectionEditor } from './collection-editor';
import type { LinkItem } from '@/lib/model';
import { InterestEditor } from './interest-editor';
import { ProjectEditor } from './project-editor';
import { LinkEditor } from './link-editor';
import { DiscordEditor } from './discord-editor';
import type { EditorPresentation } from './editor-panel';
import { interestDefinitions } from '@/lib/interests';

export type EditingItem =
  LinkItem | 'new' | 'new-project' | 'new-interest' | 'new-collection' | 'new-discord';

export function itemEditorTitle(item: EditingItem): string {
  if (item === 'new-discord') return 'Add a Discord server';
  if (item === 'new-collection') return 'Add a Game Collection';
  if (item === 'new-interest') return 'Add game';
  if (item === 'new-project') return 'Showcase a project';
  if (item === 'new') return 'A new place to find you';
  if (item.kind === 'discord') return 'Edit Discord server';
  if (item.kind === 'collection') return 'Edit Game Collection';
  if (item.kind === 'interest')
    return `Edit ${interestDefinitions[item.interest!.type].label.toLowerCase()}`;
  if (item.kind === 'project') return 'Edit your project';
  return 'Edit your link';
}

type EditorProps = {
  item: EditingItem;
  handle: string;
  existingSlugs: string[];
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
  presentation?: EditorPresentation;
  onOpenSetupGuide?: () => void;
};

export function ItemEditor({
  registerAutosave,
  saveMode = 'automatic',
  onDirtyChange,
  discardConfirmation,
  ...props
}: EditorProps & {
  registerAutosave?: (flush: FlushEntry | null) => void;
  saveMode?: 'automatic' | 'manual';
  onDirtyChange?: (dirty: boolean) => void;
  discardConfirmation?: EntryDiscardConfirmation | null;
}) {
  return (
    <EntryAutosaveContext.Provider value={registerAutosave ?? null}>
      <EntrySaveModeContext.Provider value={saveMode}>
        <EntryManualDirtyContext.Provider value={onDirtyChange ?? null}>
          <EntryDiscardConfirmationContext.Provider value={discardConfirmation ?? null}>
            <Editor {...props} />
          </EntryDiscardConfirmationContext.Provider>
        </EntryManualDirtyContext.Provider>
      </EntrySaveModeContext.Provider>
    </EntryAutosaveContext.Provider>
  );
}

function Editor({ item, onOpenSetupGuide, ...props }: EditorProps) {
  if (item === 'new-discord' || (typeof item === 'object' && item.kind === 'discord'))
    return (
      <DiscordEditor
        {...props}
        item={item === 'new-discord' ? 'new' : item}
        onOpenSetupGuide={onOpenSetupGuide}
      />
    );
  if (item === 'new-collection' || (typeof item === 'object' && item.kind === 'collection'))
    return <CollectionEditor {...props} item={item === 'new-collection' ? 'new' : item} />;
  if (item === 'new-interest' || (typeof item === 'object' && item.kind === 'interest'))
    return (
      <InterestEditor
        {...props}
        item={item === 'new-interest' ? 'new' : item}
        type={typeof item === 'object' ? item.interest!.type : 'game'}
      />
    );
  if (item === 'new-project' || (typeof item === 'object' && item.kind === 'project'))
    return <ProjectEditor {...props} project={item === 'new-project' ? 'new' : item} />;
  return <LinkEditor {...props} link={item as LinkItem | 'new'} />;
}
