import { accountMutation } from '../mutation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return accountMutation(request, false, true);
}
