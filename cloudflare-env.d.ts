declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    WYA_AUTH_MODE?: string;
    WYA_ORIGIN?: string;
    POSTHOG_PROJECT_TOKEN?: string;
    POSTHOG_HOST?: string;
    POSTHOG_PROJECT_ID?: string;
    POSTHOG_READ_KEY?: string;
    DISCORD_FEEDBACK_WEBHOOK?: string;
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
