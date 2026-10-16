declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    WYA_AUTH_MODE?: string;
    WYA_ORIGIN?: string;
    BETTER_AUTH_SECRET?: string;
    RESEND_API_KEY?: string;
    BUCKET?: R2Bucket;
    PICTURES?: R2Bucket;
  }
}
