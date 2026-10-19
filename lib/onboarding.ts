import { z } from 'zod';

export const occupationOptions = {
  developer: 'Developer',
  designer: 'Designer',
  content_creator: 'Content creator',
  student: 'Student',
  other: 'Other',
} as const;
export const purposeOptions = {
  links: 'Share links',
  projects: 'Show projects',
  interests: 'Share interests',
  business: 'Promote a business',
  explore: 'Explore',
} as const;
export const discoveryOptions = {
  friend: 'Friend',
  profile: "Someone's profile",
  social_media: 'Social media',
  search: 'Search',
  chatgpt: 'ChatGPT',
  other: 'Other',
} as const;

function optionalAnswer<Key extends string>(options: Record<Key, string>) {
  return z
    .enum(Object.keys(options) as [Key, ...Key[]])
    .nullable()
    .default(null);
}

const answersSchema = z
  .object({
    occupation: optionalAnswer(occupationOptions),
    purpose: optionalAnswer(purposeOptions),
    discovery: optionalAnswer(discoveryOptions),
  })
  .strict();

export const onboardingSchema = z.discriminatedUnion('action', [
  answersSchema.extend({ action: z.literal('complete') }),
  z.object({ action: z.literal('skip') }).strict(),
]);
export type OnboardingAnswers = z.infer<typeof answersSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type Onboarding = OnboardingAnswers & { status: 'completed' | 'skipped' };
