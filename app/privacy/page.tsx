import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '../components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What we collect, what you share, and your privacy choices.',
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" intro="Your information, your choices.">
      <section>
        <h2>Who we are</h2>
        <p>
          Wya is operated by Alex Castro. For privacy questions or requests, email{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>.
        </p>
      </section>
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account information:</strong> your email and sign-in information so you can
            access your account.
          </li>
          <li>
            <strong>Your content:</strong> the profile details, pictures, links, and other content
            you add to your spaces.
          </li>
          <li>
            <strong>Optional answers:</strong> what you do, why you use Wya, and how you found us.
            These help us decide what to build next.
          </li>
          <li>
            <strong>Security information:</strong> connection details, such as your IP address and
            browser, to protect accounts and prevent abuse.
          </li>
          <li>
            <strong>Usage information:</strong> page views, link clicks, and performance information
            to understand how Wya is used.
          </li>
          <li>
            <strong>Connected apps:</strong> the permissions you grant and information needed to
            keep those connections working.
          </li>
        </ul>
      </section>
      <section>
        <h2>What is public</h2>
        <p>
          Anyone can view, share, or copy your published content. Search engines may also show it.
          Your sign-in email stays private unless you choose to publish it, for example in your bio
          or an email link. Onboarding answers are not public.
        </p>
        <p>
          Hiding or deleting an item removes it from your public page and disables its short links.
          Copies saved by other people or search engines may remain.
        </p>
      </section>
      <section>
        <h2>Cookies and analytics</h2>
        <p>
          We use a necessary cookie to keep you signed in and security checks to protect the
          service. Cloudflare provides traffic and performance measurements.
        </p>
        <p>
          When enabled, PostHog measures views and clicks on public pages, including which page or
          item was used. We configure it without tracking cookies or session recordings, and respect
          Do Not Track and Global Privacy Control. We do not send sign-in emails or onboarding
          answers to it. Space owners see totals, not a list of identifiable visitors.
        </p>
        <p>
          Analytics providers still receive connection information, such as your IP address. PostHog
          is configured to use its EU service.
        </p>
      </section>
      <section>
        <h2>Who we share information with</h2>
        <p>We use these providers to run Wya:</p>
        <ul>
          <li>
            <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare</a> for hosting, data
            storage, security, and traffic measurements.
          </li>
          <li>
            <a href="https://resend.com/legal/privacy-policy">Resend</a> to send sign-in emails.
          </li>
          <li>
            <a href="https://posthog.com/privacy">PostHog</a> for analytics, when enabled.
          </li>
        </ul>
        <p>
          Game search uses Twitch / IGDB. Loading covers, images, or Google Fonts shares connection
          details with their providers.
        </p>
        <p>
          Apps you connect, such as ChatGPT, receive the content you authorize, which may include
          hidden items. Disconnecting stops future access but does not erase information already
          received. These apps and external websites have their own privacy policies.
        </p>
        <p>
          Providers may process information in other countries. We may also disclose information
          when required by law or needed to address abuse and protect people.
        </p>
      </section>
      <section>
        <h2>How long we keep information</h2>
        <p>
          We keep account information and content to operate your account. Up to 50 recent content
          revisions per space let you undo changes, so deleted content may remain in that history.
          Old profile pictures are deleted when replaced or removed, although cleanup may take time.
        </p>
        <p>
          Deletion may not immediately remove every backup or third-party copy. Some records may
          need to be kept for security, legal obligations, or disputes.
        </p>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          You can edit or remove content, disconnect apps, and skip, change, or clear your
          onboarding answers under Your profile → About you.
        </p>
        <p>
          Email <a href="mailto:contact@wya.im">contact@wya.im</a> to request account deletion or
          help with your information. Depending on applicable law, you may request access, a copy,
          correction, deletion, or limits on how we use it, object to processing, or withdraw
          consent. You can also complain to your data protection authority. We may need to verify
          your identity; never send your sign-in code.
        </p>
      </section>
      <section>
        <h2>Age and updates</h2>
        <p>
          Accounts are for people aged 18 or older. Contact us if you believe someone under 18 is
          using Wya. See our <Link href="/terms">Terms of Use</Link> for the account rules.
        </p>
        <p>
          The final policy will include an effective date. Important changes will be communicated
          through the service, with additional notice or consent where required.
        </p>
      </section>
    </LegalPage>
  );
}
