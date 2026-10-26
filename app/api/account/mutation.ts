import { readText } from '@/lib/request-body';
import { TAB_FILE_LIMIT } from '@/lib/tab-transfer';
import { MAX_PAGE_DOCUMENT_BYTES } from '@/lib/page-documents';
import { getChatGPTUser } from '../../chatgpt-auth';
import { mutate, getHistory, listSpaces, getAccountPlan } from '@/lib/service';
import { AppError } from '@/lib/model';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function accountMutation(request: Request, importing = false, document = false) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    return json({ error: 'Invalid request origin.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return json({ error: 'Expected JSON.' }, 415);
  try {
    const text = await readText(
      request,
      document ? MAX_PAGE_DOCUMENT_BYTES * 6 + 2048 : importing ? TAB_FILE_LIMIT + 1024 : undefined,
    );
    const input = JSON.parse(text);
    if (importing && input?.action !== 'import_tab' && input?.action !== 'paste_content')
      return json({ error: 'Expected a tab import.' }, 400);
    if (document && input?.action !== 'publish_document')
      return json({ error: 'Expected a page document.' }, 400);
    const result = await mutate(user.userId, input);
    return json({
      profile: result,
      history: await getHistory(user.userId, result.id),
      spaces: await listSpaces(user.userId),
      plan: await getAccountPlan(user.userId),
    });
  } catch (error) {
    if (error instanceof AppError) {
      // Keep an open create-space dialog accurate if access expired in another session.
      const plan = await getAccountPlan(user.userId).catch(() => undefined);
      return json({ error: error.message, ...(plan ? { plan } : {}) }, error.status);
    }
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
    console.error('Account update failed', error);
    return json({ error: 'We could not save that change. Please try again.' }, 500);
  }
}
