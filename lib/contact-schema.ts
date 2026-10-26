import { z } from 'zod';

export const CONTACT_TOPICS = {
  account: 'Account access',
  billing: 'Billing and payments',
  domain: 'Custom domain setup',
  other: 'Something else',
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;
export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 1800;

// Identity and account details come from the verified session and database only.
export const contactSchema = z
  .object({
    topic: z.enum(['account', 'billing', 'domain', 'other']),
    message: z.string().trim().min(CONTACT_MESSAGE_MIN).max(CONTACT_MESSAGE_MAX),
    spaceId: z.string().trim().min(1).max(200).optional(),
    locale: z.enum(['en', 'pt-BR']).optional(),
  })
  .strict();
