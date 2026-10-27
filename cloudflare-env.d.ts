declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    WYA_AUTH_MODE?: string;
    WYA_ORIGIN?: string;
    WYA_HOSTING_MODE?: 'hosted' | 'self-hosted';
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_PRICE_USD_MONTHLY?: string;
    STRIPE_PRICE_BRL_MONTHLY?: string;
    CUSTOM_DOMAINS_ZONE_ID?: string;
    CUSTOM_DOMAINS_API_TOKEN?: string;
    CUSTOM_DOMAINS_TARGET?: string;
    DOMAIN_MAINTENANCE?: Queue<import('./lib/domain-maintenance').DomainMaintenanceMessage>;
    POSTHOG_PROJECT_TOKEN?: string;
    POSTHOG_HOST?: string;
    POSTHOG_PROJECT_ID?: string;
    POSTHOG_READ_KEY?: string;
    DISCORD_FEEDBACK_WEBHOOK?: string;
    BETTER_AUTH_SECRET?: string;
    RESEND_API_KEY?: string;
    IGDB_CLIENT_ID?: string;
    IGDB_CLIENT_SECRET?: string;
    /** Public browser key for direct GIPHY search requests. */
    GIPHY_API_KEY?: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    BUCKET?: R2Bucket;
    PICTURES?: R2Bucket;
  }
}
