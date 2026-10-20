'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import type { LinkItem } from '@/lib/model';
import { getLayoutGroups, layoutFromGroups, type LinkLayout } from '@/lib/link-layout';
import { SectionActions } from './section-actions';
import { LinkList } from './link-list';
import { useLayoutDrag } from './use-layout-drag';

export function LayoutEditor({
  layout,
  links,
  handle,
  busy,
  onChange,
  onEdit,
  onDelete,
  tabs,
  activeTabId,
  onTabAssign,
  onSectionTabAssign,
  editingSlug,
  renderEditor,
  onCopyItem,
  onCopySection,
  onPaste,
}: {
  onCopyItem: (item: LinkItem) => Promise<boolean>;
  onCopySection: (id: string) => Promise<boolean>;
  onPaste: (sectionId: string) => void;
  editingSlug?: string;
  renderEditor?: (link: LinkItem) => ReactNode;
  tabs?: { id: string; title: string }[];
  activeTabId?: string;
  onTabAssign?: (slug: string, tabId: string) => void;
  onSectionTabAssign?: (sectionId: string, tabId: string) => void;
  layout: LinkLayout;
  links: LinkItem[];
  handle: string;
  busy: boolean;
  onChange: (layout: LinkLayout) => void;
  onEdit: (link: LinkItem) => void;
  onDelete: (link: LinkItem) => void;
}) {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState('');
  const { root, start, active, overlay, handlers } = useLayoutDrag(
    layout,
    links,
    busy,
    onChange,
    setAnnouncement,
  );
  const groups = getLayoutGroups(layout);
  function moveLink(slug: string, groupId: string, before?: string) {
    if (busy || before === slug) return;
    const next = structuredClone(layout);
    next.ungrouped = next.ungrouped.filter((item) => item !== slug);
    next.sections.forEach((section) => {
      section.slugs = section.slugs.filter((item) => item !== slug);
    });
    const slugs = groupId
      ? next.sections.find((section) => section.id === groupId)?.slugs
      : next.ungrouped;
    if (!slugs) return;
    const index = before ? slugs.indexOf(before) : -1;
    slugs.splice(index < 0 ? slugs.length : index, 0, slug);
    onChange(next);
    setAnnouncement('Link moved. Save layout to publish.');
  }
  function moveSection(from: number, to: number) {
    if (busy || from < 0 || from >= groups.length || to < 0 || to >= groups.length || from === to)
      return;
    const ordered = [...groups];
    const [group] = ordered.splice(from, 1);
    ordered.splice(to, 0, group);
    onChange(layoutFromGroups(ordered));
    setAnnouncement(`${group.title || 'Section'} moved to position ${to + 1}.`);
  }
  return (
    <div className={`layout-editor ${active ? 'layout-is-dragging' : ''}`} ref={root} {...handlers}>
      {overlay}
      {groups.reduce((count, group) => count + group.slugs.length, 0) > 1 && (
        <p className="reorder-help">{t("Drag to reorder. Save layout when you're done.")}</p>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {groups.map((group, groupIndex) => (
        <section
          key={group.id}
          data-layout-group={group.id}
          className={`layout-group ${active?.kind === 'section' && active.id === group.id ? 'layout-drag-source' : ''}`}
        >
          {(group.id || layout.sections.length > 0) && (
            <div className="section-editor-heading">
              <button
                className="icon-button drag-handle"
                aria-label={t('Drag section {name}', {
                  name: group.id ? group.title : t('No section'),
                })}
                title={t('Drag this section, or use ↑ / ↓')}
                disabled={busy}
                onPointerDown={(event) => start(event, { kind: 'section', id: group.id })}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveSection(groupIndex, groupIndex + (event.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
              >
                <GripVertical size={18} />
              </button>
              <span
                className="section-item-count"
                title={t('{count} items', { count: group.slugs.length })}
              >
                {group.slugs.length}
              </span>
              <>
                {group.id ? (
                  <input
                    aria-label={t('Section title {number}', {
                      number: layout.sections.findIndex((section) => section.id === group.id) + 1,
                    })}
                    value={group.title}
                    maxLength={60}
                    required
                    disabled={busy}
                    placeholder={t('Section title')}
                    onChange={(event) =>
                      onChange({
                        ...layout,
                        sections: layout.sections.map((section) =>
                          section.id === group.id
                            ? { ...section, title: event.target.value }
                            : section,
                        ),
                      })
                    }
                  />
                ) : (
                  <h2 className="ungrouped-heading">
                    {t('No section') + ' '}
                    <small>{t('Move this group anywhere · no public heading')}</small>
                  </h2>
                )}
              </>
              <SectionActions
                onCopy={group.id ? () => onCopySection(group.id) : undefined}
                onPaste={() => onPaste(group.id)}
                title={group.id ? group.title : t('No section')}
                busy={busy}
                canMoveUp={groupIndex > 0}
                canMoveDown={groupIndex < groups.length - 1}
                onMove={(direction) => moveSection(groupIndex, groupIndex + direction)}
                tabs={tabs}
                activeTabId={activeTabId}
                onTabAssign={
                  group.id && onSectionTabAssign
                    ? (target) => onSectionTabAssign(group.id, target)
                    : undefined
                }
                onRemove={
                  group.id
                    ? () => {
                        onChange(
                          layoutFromGroups(
                            groups
                              .filter((item) => item.id !== group.id)
                              .map((item) =>
                                item.id
                                  ? item
                                  : { ...item, slugs: [...item.slugs, ...group.slugs] },
                              ),
                          ),
                        );
                        setAnnouncement('Section removed. Its links are now under No section.');
                      }
                    : undefined
                }
              />
            </div>
          )}
          <LinkList
            onCopy={onCopyItem}
            editingSlug={editingSlug}
            renderEditor={renderEditor}
            tabs={tabs}
            activeTabId={activeTabId}
            onTabAssign={onTabAssign}
            draggingSlug={active?.kind === 'link' ? active.id : undefined}
            links={group.slugs.flatMap((slug) => links.find((link) => link.slug === slug) ?? [])}
            handle={handle}
            busy={busy}
            sections={layout.sections}
            onAssign={moveLink}
            onDragStart={(event, slug) => start(event, { kind: 'link', id: slug })}
            onEdit={onEdit}
            onDelete={onDelete}
            onMove={(from, to) => {
              const slugs = [...group.slugs];
              const [slug] = slugs.splice(from, 1);
              slugs.splice(to, 0, slug);
              onChange(
                group.id
                  ? {
                      ...layout,
                      sections: layout.sections.map((section) =>
                        section.id === group.id ? { ...section, slugs } : section,
                      ),
                    }
                  : { ...layout, ungrouped: slugs },
              );
            }}
          />
          {group.slugs.length === 0 && layout.sections.length > 0 && (
            <p className="section-empty">
              {t("Drop links here or choose this section from a link's menu.")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
