import { z } from 'zod';

export const REPORT_TOPICS = {
  account: 'Account access',
  billing: 'Billing and payments',
  domain: 'Custom domain setup',
  other: 'Something else',
} as const;
export type ReportTopic = keyof typeof REPORT_TOPICS;
export const REPORT_MESSAGE_MIN = 10;
export const REPORT_MESSAGE_MAX = 1800;

// Identity and account details come from the verified session and database only.
// A topic is report content, not a separate delivery or formatting implementation.
export const reportSchema = z
  .object({
    message: z.string().trim().min(REPORT_MESSAGE_MIN).max(REPORT_MESSAGE_MAX),
    spaceId: z.string().trim().min(1).max(200).optional(),
    locale: z.enum(['en', 'pt-BR']).optional(),
    topic: z.enum(['account', 'billing', 'domain', 'other']).optional(),
  })
  .strict();
