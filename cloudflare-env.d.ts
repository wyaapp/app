declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    WYA_AUTH_MODE?: string;
    WYA_ORIGIN?: string;
    BETTER_AUTH_SECRET?: string;
    RESEND_API_KEY?: string;
    IGDB_CLIENT_ID?: string;
    IGDB_CLIENT_SECRET?: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    BUCKET?: R2Bucket;
    PICTURES?: R2Bucket;
  }
}
