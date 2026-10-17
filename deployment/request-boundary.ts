/** Direct Workers requests do not have Sites' trusted authentication gateway. */
export function prepareCloudflareRequest(request: Request, authenticationReady = false): Request | Response {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith('oai-authenticated-user-')) headers.delete(key);
  }
  const protectedPaths = ['/connections', '/consent', '/.well-known', '/dashboard', '/api', '/mcp', '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'];
  if (!authenticationReady && protectedPaths.some(path => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
    return Response.json({error:'Account access is not enabled on this deployment. Use the Sites preview while independent authentication is configured.'}, {
      status:503,
      headers:{'Cache-Control':'no-store','Retry-After':'3600'},
    });
  }
  return new Request(request, {headers});
}

/** Private UI may never be embedded by another site (including same-site subdomains). */
export function secureResponse(request:Request,response:Response) {
  const result=new Response(response.body,response);
  result.headers.set('X-Content-Type-Options','nosniff');
  const path=new URL(request.url).pathname;
  if(['/sign-in','/dashboard','/consent','/connections','/api/auth'].some(prefix=>path===prefix || path.startsWith(prefix+'/'))) {
    result.headers.set('Content-Security-Policy',"frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    result.headers.set('X-Frame-Options','DENY');
    result.headers.set('Cache-Control','private, no-store');
    result.headers.set('Referrer-Policy','no-referrer');
  }
  return result;
}
