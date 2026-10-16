import handler from 'vinext/server/fetch-handler';
import { prepareCloudflareRequest } from './request-boundary';

// Independent hosting must never trust caller-supplied Sites identity headers.
// Private routes verify independently signed sessions or scoped OAuth tokens.
const worker = {
  fetch(request:Request, env:Cloudflare.Env, ctx:ExecutionContext) {
    const prepared = prepareCloudflareRequest(request, env.WYA_AUTH_MODE === 'email' && Boolean(env.BETTER_AUTH_SECRET && env.RESEND_API_KEY));
    if(prepared instanceof Response) return prepared;
    return handler.fetch(prepared, env, ctx);
  },
};

export default worker;
