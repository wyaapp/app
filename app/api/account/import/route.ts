import { accountMutation } from '../mutation';
export async function POST(request: Request) {
  return accountMutation(request, true);
}
