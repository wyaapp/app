import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { emailOTP, jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';

export const accountScopes = ['profile:read', 'profile:write'] as const;
export type SendCode = (email: string, code: string) => Promise<void>;

/** Shared by the Worker, schema generator, and isolated authentication tests. */
export function createAccountAuth(database: BetterAuthOptions['database'], secret: string, origin: string, sendCode: SendCode) {
  return betterAuth({
    appName: 'wya.im',
    baseURL: origin,
    basePath: '/api/auth',
    secret,
    database,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    disabledPaths: ['/token', '/oauth2/update-consent', '/sign-up/email', '/sign-in/email', '/update-user', '/delete-user', '/email-otp/check-verification-otp', '/email-otp/verify-email', '/email-otp/request-password-reset', '/forget-password/email-otp', '/email-otp/reset-password'],
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60, customRules: {
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/sign-in/email-otp': { window: 60, max: 10 },
      '/oauth2/register': { window: 3600, max: 10 },
    } },
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path !== '/oauth2/delete-consent') return;
      const session = await getSessionFromCtx(ctx);
      if (!session || typeof ctx.body?.id !== 'string') throw new APIError('UNAUTHORIZED');
      const consent = await ctx.context.adapter.findOne<{clientId:string;userId:string}>({model:'oauthConsent',where:[{field:'id',value:ctx.body.id},{field:'userId',value:session.user.id}]});
      if (!consent) throw new APIError('NOT_FOUND');
      // The library deletes consent only. Revoke its durable tokens as well so
      // a disconnected client cannot mint fresh access after reconnecting.
      const where = [{field:'userId',value:session.user.id},{field:'clientId',value:consent.clientId}];
      await ctx.context.adapter.deleteMany({model:'oauthRefreshToken',where});
      await ctx.context.adapter.deleteMany({model:'oauthAccessToken',where});
    }) },
    plugins: [
      emailOTP({
        otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP: 'hashed',
        async sendVerificationOTP({email, otp, type}) {
          if (type !== 'sign-in') throw new Error('Only sign-in codes are supported.');
          await sendCode(email, otp);
        },
      }),
      jwt(),
      mcp({
        loginPage: '/sign-in', consentPage: '/consent', resource: `${origin}/mcp`,
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
