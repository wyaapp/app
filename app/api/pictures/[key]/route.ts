import { pictures } from '@/lib/pictures';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return pictures().get((await params).key, request);
}
