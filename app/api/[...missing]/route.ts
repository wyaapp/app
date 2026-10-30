/** Unknown API paths must never resolve as public profile/short-link routes. */
function notFound() {
  return Response.json(
    { error: 'Not found.' },
    {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
export {
  notFound as GET,
  notFound as HEAD,
  notFound as POST,
  notFound as PUT,
  notFound as PATCH,
  notFound as DELETE,
  notFound as OPTIONS,
};
