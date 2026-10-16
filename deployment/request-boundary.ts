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
