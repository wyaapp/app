import { billing } from '@/lib/billing';
import { AppError } from '@/lib/app-error';
import { readText } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) return Response.json({ error: 'Missing signature.' }, { status: 400, headers });
    // Preserve the signed body verbatim; parsing belongs after signature verification.
    const raw = await readText(request, 262_144);
    await billing().webhook(raw, signature);
    return Response.json({ received: true }, { headers });
  } catch (error) {
    const status =
      error instanceof AppError && error.status >= 400 && error.status < 500 ? error.status : 503;
    return Response.json(
      { error: status >= 500 ? 'Webhook processing failed. Retry delivery.' : 'Invalid webhook.' },
      { status, headers },
    );
  }
}
