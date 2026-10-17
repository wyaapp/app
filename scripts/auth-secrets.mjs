/** Shared release preflight and stdin-only Worker secret synchronization. */
export function authSecrets(environment) {
  const names=['BETTER_AUTH_SECRET','RESEND_API_KEY','TURNSTILE_SECRET_KEY'];
  if(names.some(name=>!environment[name])) throw new Error('Configure BETTER_AUTH_SECRET, RESEND_API_KEY and TURNSTILE_SECRET_KEY before deploying email sign-in.');
  if(environment.BETTER_AUTH_SECRET.length<32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters.');
  if(/^[123]x0{10}/.test(environment.TURNSTILE_SECRET_KEY)) throw new Error('Turnstile testing keys cannot be deployed to production.');
  return Object.fromEntries(names.map(name=>[name,environment[name]]));
}
