export const dynamic = 'force-dynamic';

// Old clients get an email pointer without processing or forwarding their message.
export function POST() {
  return Response.json(
    { error: 'Support is now available by email. Please email support@wya.im.' },
    { status: 410, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
