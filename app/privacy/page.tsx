import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '../components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Wya handles account information, public profiles, and analytics.',
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What Wya needs to work, what you choose to share, and the controls available to you."
    >
      <section>
        <h2>Who is responsible</h2>
        <p>
          This notice covers wya.im, its account dashboard, and its connected profile tools. Wya is
          operated by Alex Castro, an individual responsible for the processing of personal
          information described in this notice. For privacy questions and requests, email{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>.
        </p>
      </section>
      <section>
        <h2>What we handle and why</h2>
        <ul>
          <li>
            <strong>Your account:</strong> email address, internal account ID, account timestamps,
            and verification status so you can sign in and manage your spaces. Wya uses email codes,
            not passwords.
          </li>
          <li>
            <strong>Your spaces:</strong> handles, names, bios, pictures, links, projects, games,
            tabs, sections, appearance settings, visibility settings, and saved revisions so we can
            store, display, edit, and restore your content.
          </li>
          <li>
            <strong>Sign-in and security:</strong> hashed verification codes, session and
            authorization records, IP addresses, browser information, and abuse-prevention counters
            to authenticate requests, protect accounts, and limit spam. Hosting providers also
            process technical request information.
          </li>
          <li>
            <strong>Connected apps:</strong> client identifiers, permissions, consent records, and
            tokens when you authorize a connection such as ChatGPT. Authorized tools can read or
            change your spaces within the permissions you grant.
          </li>
          <li>
            <strong>Usage measurements:</strong> traffic and performance information, and, when
            enabled, public profile views and item-link clicks, to understand how the service is
            used and show space owners aggregate activity.
          </li>
        </ul>
        <p>
          For the final notice, the operator must confirm the applicable legal bases for these
          purposes. The proposed bases are providing the service you request, legitimate interests
          in security and service operation where permitted, legal obligations where applicable, and
          consent where required. Acceptance of the Terms is not blanket consent to optional data
          processing.
        </p>
      </section>
      <section>
        <h2>What becomes public</h2>
        <p>
          Published profiles and visible content can be accessed by anyone with the address, shared,
          indexed by search engines, or copied by others. Do not publish information you want to
          keep private. Your sign-in email is not automatically displayed on your profile; an email
          address you add to a public link or bio is public.
        </p>
        <p>
          Hiding or removing an item stops its normal public display and disables its short links.
          It does not erase copies held by other people, search engines, or caches. Unpublished
          content and revision history are available to you and to connected tools with the access
          you authorize.
        </p>
      </section>
      <section>
        <h2>Cookies and analytics</h2>
        <p>
          Wya uses an essential session cookie to keep you signed in. Sessions have a 30-day
          lifetime and may renew while you use the service. Security checks may also process browser
          and network signals.
        </p>
        <p>
          Cloudflare Web Analytics provides site-wide traffic and performance reporting. It operates
          separately from the optional PostHog integration described below.
        </p>
        <p>
          When enabled, PostHog records public page views and clicks on profile links and buttons.
          Events include the public page address, a hashed stable space identifier, and, for clicks,
          the item identifier. The app omits query strings, fragments, link destinations, labels,
          and sign-in email addresses from these events. Legacy item identifiers may contain a
          public link slug.
        </p>
        <p>
          The PostHog integration is configured for cookieless operation, without persistent browser
          storage, account identification, session recordings, or automatic capture of everything
          you do. It respects Do Not Track and Global Privacy Control. It is not mounted on sign-in,
          dashboard, OAuth, or API pages. These restrictions apply to Wya&apos;s PostHog
          integration, not every third-party request.
        </p>
        <p>
          Cookieless does not mean no data processing: PostHog receives network information and uses
          a daily server-side hash for measurement. Space owners see aggregate views and clicks, not
          visitor email addresses or a list of identifiable visitors. The configured PostHog project
          is hosted in the EU; this does not mean all Wya data stays in the EU.
        </p>
      </section>
      <section>
        <h2>Services involved</h2>
        <ul>
          <li>
            <strong>Cloudflare:</strong> hosting, database and picture storage, network delivery,
            Web Analytics, and Turnstile security checks. See{' '}
            <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare&apos;s privacy policy</a>{' '}
            and the{' '}
            <a href="https://www.cloudflare.com/turnstile-privacy-policy/">
              Turnstile privacy addendum
            </a>
            .
          </li>
          <li>
            <strong>Resend:</strong> receives your email address and the sign-in email content to
            deliver login codes. See{' '}
            <a href="https://resend.com/legal/privacy-policy">Resend&apos;s privacy policy</a>.
          </li>
          <li>
            <strong>PostHog, when enabled:</strong> receives the analytics events described above.
            See <a href="https://posthog.com/privacy">PostHog&apos;s privacy policy</a>.
          </li>
          <li>
            <strong>Twitch / IGDB:</strong> powers game search. Catalog searches are sent through
            Wya&apos;s server; game covers can load from IGDB&apos;s image servers.
          </li>
          <li>
            <strong>Google Fonts and image hosts:</strong> fonts and externally hosted covers load
            in your browser. Their hosts receive connection details such as your IP address and
            browser information. External cover requests use a no-referrer policy.
          </li>
          <li>
            <strong>Apps you connect and sites you visit:</strong> connecting ChatGPT or another
            supported client shares authorized tool requests and results with that client. Following
            an external link takes you to another service with its own policies.
          </li>
        </ul>
        <p>
          Wya receives tool calls and returns their results; it does not need your full chat history
          to provide this connection. Disconnecting an app prevents future authorized access through
          that connection but does not remove data already received by it.
        </p>
        <p>
          Providers may process data in other countries. Applicable transfer mechanisms, provider
          agreements, and processing locations must be confirmed before this draft is published.
          Information may also be disclosed when required by law or necessary to investigate abuse
          and protect users&apos; rights.
        </p>
      </section>
      <section>
        <h2>Retention and removal</h2>
        <p>
          Current account and space data are kept to operate your account. Wya retains up to 50
          content revisions per space; removing a link from the current profile does not immediately
          remove it from those revisions. Older revisions are pruned as new ones are saved.
        </p>
        <p>
          Replacing or removing a profile picture schedules deletion of the previous stored image.
          Failed or abandoned image cleanup is retried by scheduled maintenance; Wya does not offer
          photo history. Cached or independently copied images may remain elsewhere.
        </p>
        <p>
          Login codes expire after five minutes. Expiry limits validity and does not itself
          guarantee immediate deletion of every associated record. Expired abuse counters are
          cleaned up by maintenance. Account records, provider logs, analytics, and backup retention
          need a documented schedule before publication; this draft does not promise immediate
          deletion from every system.
        </p>
      </section>
      <section>
        <h2>Your choices and requests</h2>
        <p>
          You can edit your profile, hide or remove items, replace or remove your picture, and
          revoke connected-app access. Depending on applicable law, you may also request access,
          correction, deletion, information about sharing, portability, restriction, or objection to
          processing, and withdrawal of consent where consent is used. You may complain to the
          relevant data protection authority, including Brazil&apos;s ANPD where applicable.
        </p>
        <p>
          There is currently no self-service account-deletion button. For account deletion or other
          rights requests, email <a href="mailto:contact@wya.im">contact@wya.im</a>. Requests may
          require proportionate identity verification; never send your sign-in code. Some records
          may need to be retained to meet legal obligations or resolve disputes.
        </p>
      </section>
      <section>
        <h2>Age and policy changes</h2>
        <p>
          Wya accounts are for people aged 18 or older. If you believe someone under 18 has created
          an account or submitted personal information, contact{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a> so the operator can review the report
          and take appropriate action. An age requirement in the{' '}
          <Link href="/terms">Terms of Use</Link> is not a claim that Wya has independently verified
          every user&apos;s age.
        </p>
        <p>
          The published policy will carry an effective date. Material changes should be communicated
          through the service, with additional notice or consent where required.
        </p>
      </section>
    </LegalPage>
  );
}
