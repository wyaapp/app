import { tools, readTools } from './mcp-tools';
import { searchCatalog } from './catalog';
import { mcpFileActions, mcpFileReadSchema } from './mcp-file-tools';
import { createSpaceFileService } from './space-file-service';
import { MAX_FILE_BYTES } from './space-files';
import { env } from 'cloudflare:workers';
import { readText } from './request-body';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getAccount, getHistory, listSpaces, mutate, getAccountPlan } from './service';
import { authOrigin } from './auth/server';
import { createInsufficientScopeError } from 'better-auth/oauth2';
import { AppError } from './app-error';
import { spaceSelectorSchema, pictureActionSchema } from './profile-action-schema';
import { pictures } from './pictures';

export async function handleMcpRequest(
  request: Request,
  identity?: { userId: string; scopes: Set<string> },
) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    return new Response('Expected JSON', { status: 415 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return new Response('Invalid origin', { status: 403 });
  let body: {
    id?: string | number | null;
    jsonrpc?: string;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  const respond = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const text = await readText(request, MAX_FILE_BYTES * 6 + 4096);
    body = JSON.parse(text);
    if (!body || Array.isArray(body) || body.jsonrpc !== '2.0') throw new Error();
  } catch (error) {
    if (error instanceof AppError)
      return respond(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: error.message } },
        error.status,
      );
    return respond({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Invalid JSON-RPC request' },
    });
  }
  const id = body.id ?? null;
  const result = (value: unknown) => respond({ jsonrpc: '2.0', id, result: value });
  if (body.method === 'server/discover')
    return result({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} } });
  if (body.method === 'initialize')
    return result({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'wya.im', version: '1.0.0' },
    });
  if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (body.method === 'tools/list')
    return result({
      tools: tools.map((tool) => ({
        ...tool,
        securitySchemes: [
          {
            type: 'oauth2',
            scopes: readTools.has(tool.name) ? ['profile:read'] : ['profile:read', 'profile:write'],
          },
        ],
      })),
    });
  if (body.method !== 'tools/call')
    return respond({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  const user = identity || (await getChatGPTUser());
  if (!user)
    return result({
      isError: true,
      content: [{ type: 'text', text: 'Sign in to wya.im to manage your profile.' }],
    });
  if (identity && !readTools.has(body.params?.name ?? '') && !identity.scopes.has('profile:write'))
    throw createInsufficientScopeError(['profile:write']);
  try {
    const name = body.params?.name;
    if (!tools.some((t) => t.name === name)) throw new AppError('Unknown tool.');
    let data: unknown;
    if (name === 'search_catalog') {
      data = await searchCatalog(user.userId, body.params?.arguments);
    } else if (name === 'list_spaces') {
      if (Object.keys(body.params?.arguments ?? {}).length)
        throw new AppError('list_spaces does not accept arguments.');
      data = {
        spaces: await listSpaces(user.userId),
        limit: (await getAccountPlan(user.userId)).spaceLimit,
      };
    } else if (name === 'get_profile') {
      const parsed = spaceSelectorSchema.safeParse(body.params?.arguments ?? {});
      if (!parsed.success) throw new AppError('Pass only the spaceId from list_spaces.');
      const profile = await getAccount(user.userId, parsed.data.spaceId);
      data = {
        profile,
        history: profile ? await getHistory(user.userId, profile.id) : [],
        pictureEditorUrl: profile
          ? `${authOrigin()}/dashboard/profile?space=${encodeURIComponent(profile.id)}`
          : null,
      };
    } else if (
      name === 'list_files' ||
      name === 'list_trash' ||
      name === 'read_file' ||
      (name && name in mcpFileActions)
    ) {
      const { spaceId, ...fileInput } = body.params?.arguments ?? {};
      const selector = spaceSelectorSchema.safeParse(spaceId === undefined ? {} : { spaceId });
      if (!selector.success) throw new AppError('Pass the spaceId from list_spaces.');
      const profile = await getAccount(user.userId, selector.data.spaceId);
      if (!profile) throw new AppError('Create your first space.', 404);
      const files = createSpaceFileService(env.DB!);
      if (name === 'list_files' || name === 'list_trash') {
        if (Object.keys(fileInput).length)
          throw new AppError('Pass only the spaceId from list_spaces.');
        data =
          name === 'list_trash'
            ? await files.getTrash(user.userId, profile.id)
            : await files.get(user.userId, profile.id);
      } else if (name === 'read_file') {
        const parsed = mcpFileReadSchema.safeParse(body.params?.arguments);
        if (!parsed.success) throw new AppError('Pass the file ID from list_files.');
        data = await files.get(user.userId, profile.id, parsed.data.id);
      } else {
        data = await files.change(user.userId, profile.id, {
          ...fileInput,
          action: mcpFileActions[name as keyof typeof mcpFileActions],
        });
      }
    } else if (name === 'remove_profile_picture' || name === 'copy_profile_picture') {
      const parsed = pictureActionSchema.safeParse({ ...body.params?.arguments, action: name });
      if (!parsed.success)
        throw new AppError(
          'Pass the space ID, current expectedVersion, and sourceSpaceId when copying a picture.',
        );
      const action = parsed.data;
      data = {
        profile:
          action.action === 'remove_profile_picture'
            ? await pictures().remove(user.userId, action.spaceId, action.expectedVersion)
            : await pictures().copy(
                user.userId,
                action.spaceId,
                action.expectedVersion,
                action.sourceSpaceId,
              ),
      };
    } else {
      const { fileId, ...arguments_ } = body.params?.arguments ?? {};
      data = {
        profile: await mutate(user.userId, {
          ...arguments_,
          ...(fileId === undefined ? {} : { tabId: fileId }),
          action: name,
        }),
      };
    }
    // Legacy action adapters can use a computed layout internally, but the API
    // exposes Markdown files as the sole content model.
    if (data && typeof data === 'object' && 'profile' in data && data.profile) {
      const {
        tabs: _tabs,
        defaultTabId: _defaultTabId,
        documents: _documents,
        sections: _sections,
        ungroupedPosition: _ungroupedPosition,
        ...profile
      } = data.profile as Record<string, unknown>;
      void [_tabs, _defaultTabId, _documents, _sections, _ungroupedPosition];
      data = { ...data, profile };
    }
    return result({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  } catch (error) {
    if (!(error instanceof AppError)) console.error('MCP operation failed', error);
    return result({
      isError: true,
      content: [
        {
          type: 'text',
          text:
            error instanceof AppError ? error.message : 'Could not complete the change. Try again.',
        },
      ],
    });
  }
}
