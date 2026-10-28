import { createSpaceTrashService, type TrashChangeResult } from './space-trash-service.ts';
import { readTrash, trashActionSchema } from './space-trash.ts';
import { createSpaceStore } from './space-store.ts';
import { resolveLinkDestination } from './link-redirects.ts';
import { visibleProfile } from './public-profile.ts';
import { AppError } from './app-error.ts';
import { normalizeDocumentAppearance, sameDocumentAppearance } from './document-appearance.ts';
import { consumeLimit, digestKey } from './abuse-limits.ts';
import { createSpaceFolderStore } from './space-folder-service.ts';
import { parseFileDocument } from './file-documents.ts';
import { getFileFormat, isRichTextFile } from './file-formats.ts';
import { parseWidgetSource } from './widget-files.ts';
import { publicProfileFiles, profileFileLinks } from './profile-files.ts';
import { allItems } from './collections.ts';
import { fileNavigationOrder } from './file-navigation.ts';
import { folderActionSchema, publicFolders, type SpaceFolder } from './space-folders.ts';
import {
  commitMarkdownFiles,
  ensureMarkdownFiles,
  readMarkdownFiles,
} from './markdown-file-store.ts';
import type { LinkItem, ProfileData } from './profile-types.ts';
import { pageDirectiveItem, parsePageSource, serializePageItem } from './page-documents.ts';
import type { Nodes } from 'mdast';
import {
  fileActionSchema,
  MAX_SPACE_FILES,
  MAX_FILE_BYTES,
  fileBytes,
  fileInfo,
  type SpaceFile,
} from './space-files.ts';

/** Every document, including migrated profile pages, uses this same file boundary. */
export function createSpaceFileService(db: D1Database) {
  const folders = createSpaceFolderStore(db);
  async function owned(userId: string, spaceId: string) {
    if (
      !(await db
        .prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?')
        .bind(spaceId, userId)
        .first())
    )
      throw new AppError('Space not found.', 404);
    return ensureMarkdownFiles(db, spaceId);
  }
  async function get(userId: string, spaceId: string, id?: string) {
    const space = await owned(userId, spaceId);
    const files = await readMarkdownFiles(db, spaceId);
    const data = JSON.parse(space.data) as ProfileData;
    if (id) {
      const file = files.find((file) => file.id === id);
      if (!file) throw new AppError('File not found.', 404);
      return { file, defaultFileId: data.defaultFileId ?? null };
    }
    return {
      files: files.map(fileInfo),
      folders: await folders.list(spaceId),
      defaultFileId: data.defaultFileId ?? null,
    };
  }
  async function getTrash(userId: string, spaceId: string) {
    await owned(userId, spaceId);
    return { trash: await readTrash(db, spaceId) };
  }
  async function publicGet(handle: string, id?: string) {
    const row = await db
      .prepare('SELECT space_id AS id FROM space_handles WHERE handle = ?')
      .bind(handle)
      .first<{ id: string }>();
    if (!row) throw new AppError('Space not found.', 404);
    const space = await ensureMarkdownFiles(db, row.id);
    const files = publicProfileFiles(await readMarkdownFiles(db, row.id));
    const data = JSON.parse(space.data) as ProfileData;
    const defaultFileId =
      files.find((file) => file.id === data.defaultFileId)?.id ??
      fileNavigationOrder(files)[0]?.id ??
      null;
    if (id) {
      const file = files.find((file) => file.id === id);
      if (!file) throw new AppError('File not found.', 404);
      return { file, defaultFileId };
    }
    return {
      files: files.map(fileInfo),
      folders: publicFolders(await folders.list(row.id), files),
      defaultFileId,
    };
  }
  async function change(
    userId: string,
    spaceId: string,
    input: unknown,
  ): Promise<
    Partial<TrashChangeResult> & {
      file?: SpaceFile;
      deleted?: string;
      folder?: SpaceFolder;
      deletedFolder?: string;
      defaultFileId?: string | null;
      reorderedFiles?: {
        id: string;
        previousVersion: number;
        version: number;
        position: number;
        updatedAt: string;
      }[];
    }
  > {
    const space = await owned(userId, spaceId);
    const data = JSON.parse(space.data) as ProfileData;
    const trashAction = trashActionSchema.safeParse(input);
    if (trashAction.success) {
      await consumeLimit(db, `files:${await digestKey(userId)}`, 120, 60_000);
      return createSpaceTrashService(db).change(space, trashAction.data);
    }
    const folderAction = folderActionSchema.safeParse(input);
    if (folderAction.success) {
      await consumeLimit(db, `files:${await digestKey(userId)}`, 120, 60_000);
      if (folderAction.data.action === 'delete-folder')
        return createSpaceTrashService(db).deleteFolder(
          space,
          folderAction.data.id,
          folderAction.data.version,
        );
      return {
        ...(await folders.change(spaceId, folderAction.data)),
        defaultFileId: data.defaultFileId ?? null,
      };
    }
    const parsed = fileActionSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError('Use a valid .md, .txt, or .widget filename and plain text up to 128 KB.');
    const action = parsed.data;
    await consumeLimit(db, `files:${await digestKey(userId)}`, 120, 60_000);
    const before = await readMarkdownFiles(db, spaceId);
    const files = structuredClone(before);
    const now = new Date().toISOString();
    const desktopId = await folders.desktopId(spaceId);
    const id = action.action === 'create' ? crypto.randomUUID() : action.id;
    let next: SpaceFile | undefined;
    if (action.action === 'create') {
      if (getFileFormat(action.name) === 'widget') parseWidgetSource(action.content);
      if (files.length >= MAX_SPACE_FILES)
        throw new AppError('This space has reached its 30-file limit.');
      await folders.requireFolder(spaceId, action.folderId);
      next = {
        id,
        name: action.name,
        content: action.content,
        appearance: normalizeDocumentAppearance(action.appearance),
        folderId: action.folderId,
        size: fileBytes(action.content),
        version: 1,
        published: false,
        hasChanges: false,
        pinned: Boolean(desktopId) && action.folderId === desktopId,
        updatedAt: now,
        position: Math.min(1000, Math.max(-1, ...files.map((file) => file.position ?? 1000)) + 1),
        publishedAt: null,
        publishedName: null,
        publishedContent: null,
        publishedAppearance: {},
      };
      files.push(next);
    } else {
      next = files.find((file) => file.id === id);
      if (!next) throw new AppError('File not found.', 404);
      if (next.version !== action.version)
        throw new AppError(
          'This file changed elsewhere. Download your edits before reloading it.',
          409,
        );
      if (action.action === 'delete') files.splice(files.indexOf(next), 1);
      else {
        if (action.action === 'save') {
          if (getFileFormat(action.name) === 'widget') parseWidgetSource(action.content);
          const appearance = normalizeDocumentAppearance(action.appearance ?? next.appearance);
          // A repeated explicit save is a read after ownership/version validation.
          // Keep the revision and published index untouched when nothing changed.
          if (
            action.name === next.name &&
            action.content === next.content &&
            sameDocumentAppearance(appearance, next.appearance)
          )
            return {
              file: next,
              defaultFileId:
                files.find((file) => file.id === data.defaultFileId)?.id ??
                fileNavigationOrder(files)[0]?.id ??
                null,
            };
          Object.assign(next, {
            name: action.name,
            content: action.content,
            appearance,
          });
        }
        if (action.action === 'publish') {
          if (getFileFormat(next.name) === 'widget') {
            const block = parseWidgetSource(next.content, { allowEmpty: false });
            if (block?.kind === 'discord' && !block.item.visible)
              throw new AppError('Make the Discord block visible before publishing this widget.');
          }
          const publishedItems = allItems(profileFileLinks(before, true));
          const reservedIds = new Map<string, string | undefined>();
          for (const item of publishedItems)
            if (item.id && !reservedIds.has(item.id)) reservedIds.set(item.id, item.fileId);
          let content = next.content;
          if (isRichTextFile(next.name)) {
            const parsed = parseFileDocument(content, { publish: true });
            let reassigned = false;
            function uniqueIdentity(item: LinkItem): LinkItem {
              const duplicate =
                item.id && reservedIds.has(item.id) && reservedIds.get(item.id) !== id;
              if (duplicate) reassigned = true;
              return {
                ...item,
                ...(duplicate ? { id: crypto.randomUUID() } : {}),
                ...(item.collection
                  ? {
                      collection: {
                        ...item.collection,
                        items: item.collection.items.map(uniqueIdentity),
                      },
                    }
                  : {}),
              };
            }
            const items = parsed.data.links.map(uniqueIdentity);
            // Copies get their own analytics identity without asking people to
            // edit internal IDs or changing the source file they copied from.
            content = parsed.source;
            if (reassigned) {
              const replacements = new Map(
                parsed.data.links.flatMap((item, index) =>
                  JSON.stringify(item) === JSON.stringify(items[index])
                    ? []
                    : [[item.id ?? `legacy:${item.slug}`, items[index]] as const],
                ),
              );
              const patches: { start: number; end: number; value: string }[] = [];
              function visit(node: Nodes) {
                const item = pageDirectiveItem(node);
                const replacement = item && replacements.get(item.id ?? `legacy:${item.slug}`);
                if (replacement)
                  patches.push({
                    start: node.position!.start.offset!,
                    end: node.position!.end.offset!,
                    value: serializePageItem(replacement),
                  });
                else if (node.type === 'containerDirective' && node.name === 'section')
                  node.children.forEach(visit);
              }
              parsePageSource(content, { preserveUnknown: true }).tree.children.forEach(visit);
              for (const patch of patches.sort((a, b) => b.start - a.start))
                content = content.slice(0, patch.start) + patch.value + content.slice(patch.end);
            }
          }
          if (fileBytes(content) > MAX_FILE_BYTES)
            throw new AppError('Files must be plain text, up to 128 KB.');
          const published = {
            ...next,
            content,
            published: true,
            publishedAt: now,
            publishedName: next.name,
            publishedContent: content,
            publishedAppearance: next.appearance,
          };
          const reserved = new Map(
            allItems(profileFileLinks(before, true)).flatMap((item) =>
              [item.slug, ...(item.aliases ?? [])].map((slug) => [slug, item.fileId] as const),
            ),
          );
          for (const item of allItems(profileFileLinks([published], true))) {
            for (const slug of [item.slug, ...(item.aliases ?? [])]) {
              if (reserved.has(slug) && reserved.get(slug) !== id)
                throw new AppError(
                  `The short link /${slug} is already published in another file. Choose a unique slug before publishing.`,
                  409,
                );
            }
          }
          Object.assign(next, published);
        }
        if (action.action === 'unpublish')
          Object.assign(next, {
            published: false,
            publishedAt: null,
            publishedName: null,
            publishedContent: null,
            publishedAppearance: {},
          });
        if (action.action === 'pin') next.folderId = action.pinned ? desktopId : null;
        if (action.action === 'move') {
          await folders.requireFolder(spaceId, action.folderId);
          next.folderId = action.folderId;
        }
        if (action.action === 'properties') {
          if (getFileFormat(action.name) === 'widget') parseWidgetSource(next.content);
          next.name = action.name;
          const ordered = [...files].sort(
            (a, b) => (a.position ?? 1000) - (b.position ?? 1000) || a.id.localeCompare(b.id),
          );
          ordered.splice(
            ordered.findIndex((file) => file.id === id),
            1,
          );
          ordered.splice(Math.min(action.position, ordered.length), 0, next);
          for (const [position, file] of ordered.entries()) {
            if (file.position === position) continue;
            file.position = position;
            if (file.id !== id) {
              file.version++;
              file.updatedAt = now;
            }
          }
          if (action.isDefault === true) data.defaultFileId = id;
          else if (action.isDefault === false && data.defaultFileId === id)
            delete data.defaultFileId;
        }
        next.version++;
        next.updatedAt = now;
        next.size = fileBytes(next.content);
        next.pinned = Boolean(desktopId) && next.folderId === desktopId;
        next.hasChanges =
          next.published &&
          (next.name !== next.publishedName ||
            next.content !== next.publishedContent ||
            !sameDocumentAppearance(next.appearance, next.publishedAppearance));
      }
    }
    if (action.action === 'publish') {
      const store = createSpaceStore(db);
      const owner = (await store.getAccount(userId, spaceId))!;
      const proposed = { ...owner, files, links: profileFileLinks(files, true) };
      const publicProfile = visibleProfile(proposed);
      async function resolveProfile(handle: string) {
        if (handle === owner.handle || owner.aliases.includes(handle)) return publicProfile;
        const other = await store.findByHandle(handle, false);
        return other ? (other.id === spaceId ? publicProfile : visibleProfile(other)) : null;
      }
      try {
        for (const item of allItems(publicProfile.links).filter((item) => item.fileId === id))
          await resolveLinkDestination(publicProfile, item.slug, resolveProfile, {
            allowUnavailable: true,
          });
      } catch (error) {
        if (error instanceof AppError && error.status === 508) throw new AppError(error.message);
        throw error;
      }
    }
    try {
      const historical =
        action.action === 'publish' ||
        action.action === 'unpublish' ||
        action.action === 'delete' ||
        action.action === 'properties';
      await commitMarkdownFiles(
        db,
        space,
        before,
        files,
        data,
        historical
          ? {
              reason: `${action.action === 'publish' ? 'Published' : action.action === 'unpublish' ? 'Unpublished' : action.action === 'delete' ? 'Deleted' : 'Updated properties of'} ${next!.name}`,
              bumpVersion: true,
              now,
            }
          : { now },
      );
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed'))
        throw new AppError('A file with this name already exists.', 409);
      if (String(error).includes('FOREIGN KEY constraint failed'))
        throw new AppError('Folder not found.', 404);
      throw error;
    }
    const defaultFileId =
      files.find((file) => file.id === data.defaultFileId)?.id ??
      fileNavigationOrder(files)[0]?.id ??
      null;
    return action.action === 'delete'
      ? { deleted: id, defaultFileId }
      : {
          file: next!,
          defaultFileId,
          ...(action.action === 'properties'
            ? {
                reorderedFiles: files.flatMap((file) => {
                  const previous = before.find((saved) => saved.id === file.id);
                  return file.id !== id && previous && previous.version !== file.version
                    ? [
                        {
                          id: file.id,
                          previousVersion: previous.version,
                          version: file.version,
                          position: file.position ?? 1000,
                          updatedAt: file.updatedAt,
                        },
                      ]
                    : [];
                }),
              }
            : {}),
        };
  }
  return { get, getTrash, publicGet, change };
}
