import { z } from 'zod';
import type { MailGuard } from './mail-guard.ts';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { emailOTP, jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';

export const accountScopes = ['profile:read', 'profile:write'] as const;
export type SendCode = (email: string, code: string) => Promise<void>;

/** Shared by the Worker, schema generator, and isolated authentication tests. */
export function createAccountAuth(
  database: BetterAuthOptions['database'],
  secret: string,
  origin: string,
  sendCode: SendCode,
  guard?: MailGuard,
) {
  return betterAuth({
    appName: 'wya.im',
    baseURL: origin,
    basePath: '/api/auth',
    secret,
    database,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    disabledPaths: [
      '/token',
      '/oauth2/update-consent',
      '/sign-up/email',
      '/sign-in/email',
      '/update-user',
      '/delete-user',
      '/email-otp/check-verification-otp',
      '/email-otp/verify-email',
      '/email-otp/request-password-reset',
      '/forget-password/email-otp',
      '/email-otp/reset-password',
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 60, max: 10 },
        '/oauth2/register': { window: 3600, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/email-otp/send-verification-otp') {
          if (ctx.headers?.get('origin') !== origin) throw new APIError('FORBIDDEN');
          const parsed = z
            .object({ email: z.email().max(254), type: z.literal('sign-in') })
            .safeParse(ctx.body);
          if (!parsed.success)
            throw new APIError('BAD_REQUEST', { message: 'Enter a valid email address.' });
          const email = parsed.data.email.toLowerCase();
          const release = (await guard?.acquire(email, ctx.headers)) ?? (async () => {});
          try {
            const active = await ctx.context.internalAdapter.findVerificationValue(
              `sign-in-otp-${email}`,
            );
            if (active && new Date(active.expiresAt).getTime() > Date.now()) {
              throw new APIError('TOO_MANY_REQUESTS', {
                code: 'OTP_ACTIVE',
                message:
                  'A code is already active. Use the email already sent, or wait 5 minutes before requesting a new one.',
              });
            }
            await guard?.reserve(email);
          } catch (error) {
            await release();
            throw error;
          }
          // The library normally logs and swallows delivery errors. Override only
          // this request's callback runner so callers receive the real failure.
          return {
            context: {
              context: {
                runInBackgroundOrAwait: async (promise: Promise<unknown>) => {
                  try {
                    await promise;
                  } finally {
                    await release();
                  }
                },
              },
            },
          };
        }
        if (ctx.path !== '/oauth2/delete-consent') return;
        const session = await getSessionFromCtx(ctx);
        if (!session || typeof ctx.body?.id !== 'string') throw new APIError('UNAUTHORIZED');
        const consent = await ctx.context.adapter.findOne<{ clientId: string; userId: string }>({
          model: 'oauthConsent',
          where: [
            { field: 'id', value: ctx.body.id },
            { field: 'userId', value: session.user.id },
          ],
        });
        if (!consent) throw new APIError('NOT_FOUND');
        // The library deletes consent only. Revoke its durable tokens as well so
        // a disconnected client cannot mint fresh access after reconnecting.
        const where = [
          { field: 'userId', value: session.user.id },
          { field: 'clientId', value: consent.clientId },
        ];
        await ctx.context.adapter.deleteMany({ model: 'oauthRefreshToken', where });
        await ctx.context.adapter.deleteMany({ model: 'oauthAccessToken', where });
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }, ctx) {
          if (type !== 'sign-in') throw new Error('Only sign-in codes are supported.');
          try {
            await sendCode(email, otp);
          } catch {
            // An undelivered challenge must not block a later retry. The guard's
            // recipient lock remains held until this cleanup completes.
            await ctx?.context.internalAdapter.deleteVerificationByIdentifier(
              `sign-in-otp-${email}`,
            );
            throw new APIError('SERVICE_UNAVAILABLE', {
              message: 'We could not send your code. Please try again shortly.',
            });
          }
        },
      }),
      jwt(),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: `${origin}/mcp`,
        scopes: [...accountScopes, 'offline_access'],
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationRequirePKCE: true,
        clientRegistrationDefaultScopes: [...accountScopes, 'offline_access'],
        accessTokenExpiresIn: 300,
        refreshTokenExpiresIn: 60 * 60 * 24 * 30,
        clientPrivileges: () => false,
        resourcePrivileges: () => false,
      }),
    ],
  });
}
