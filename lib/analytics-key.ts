/** Never send legacy space IDs (which can contain authentication IDs) to analytics. */
export async function analyticsSpaceKey(spaceId:string) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`wya-space:${spaceId}`));
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
