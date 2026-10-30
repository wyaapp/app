import { boundedAuthRequest } from '@/lib/request-body';
import { AppError } from '@/lib/model';
import { getAuth, isStandalone } from '@/lib/auth/server';
import { appOrigin, publicOrigin } from '@/lib/site-origin';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!isStandalone()) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  // The app has browser sessions only. Connector OAuth remains on the public issuer.
  if (
    url.origin === appOrigin() &&
    appOrigin() !== publicOrigin() &&
    ![
      '/api/auth/email-otp/send-verification-otp',
      '/api/auth/sign-in/email-otp',
      '/api/auth/get-session',
      '/api/auth/sign-out',
    ].includes(url.pathname)
  )
    return Response.json({ error: 'Not found.' }, { status: 404 });
  let bounded: Request;
  try {
    bounded = await boundedAuthRequest(request);
  } catch (error) {
    if (error instanceof AppError)
      return Response.json(
        { message: error.message },
        { status: error.status, headers: { 'Cache-Control': 'private, no-store' } },
      );
    throw error;
  }
  const response = await getAuth(new URL(request.url).origin).handler(bounded);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export { handle as GET, handle as POST };
