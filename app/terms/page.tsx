import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '../components/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The rules for accounts, content, links, and connected tools on Wya.',
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro="A shared understanding of how you can use Wya and what to expect from the service."
    >
      <section>
        <h2>About these terms</h2>
        <p>
          Wya lets you create public spaces for links, projects, and interests, and manage them
          through the dashboard or authorized connected tools. Wya is operated by Alex Castro as an
          individual. Contact: <a href="mailto:contact@wya.im">contact@wya.im</a>. This is a
          proposed agreement for review, not an active agreement.
        </p>
        <p>
          The <Link href="/privacy">Privacy Policy</Link> explains how personal information is
          handled. It is separate from permission to use your content or consent to optional
          processing.
        </p>
      </section>
      <section>
        <h2>Eligibility and your account</h2>
        <p>
          You must be at least 18 years old to create or use a Wya account, have authority to accept
          this agreement, and use an email account you control. Keep sign-in codes and connected-app
          access secure, and report suspected unauthorized access at{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>.
        </p>
        <p>
          Do not create an account on behalf of someone under 18 or misrepresent your eligibility.
          Suspected underage accounts may be reviewed and restricted. This age requirement does not
          mean Wya has independently verified every account holder&apos;s age.
        </p>
      </section>
      <section>
        <h2>Your content stays yours</h2>
        <p>
          You keep your rights to the content you provide. You grant Wya a non-exclusive permission
          to host, store, copy, format, and display it as needed to run the service and carry out
          your instructions, including publishing the content you choose to make visible. This
          permission does not transfer ownership of your work to Wya.
        </p>
        <p>
          Only upload or link content you are allowed to use. You are responsible for your profile
          content and link destinations, including any personal information you publish about other
          people. Public content may be copied or indexed outside Wya&apos;s control. Removal from
          the current profile does not instantly remove retained revisions, backups, or third-party
          copies; retention is described in the Privacy Policy.
        </p>
      </section>
      <section>
        <h2>Use Wya responsibly</h2>
        <p>
          Do not use Wya to distribute malware, run phishing or fraud, impersonate others
          deceptively, harass or threaten people, exploit children, publish others&apos; private
          information without authorization, infringe intellectual-property rights, or distribute
          unlawful content.
        </p>
        <p>
          Do not bypass authentication, access other users&apos; private data, evade rate limits,
          disrupt the service, or use automation to claim usernames in bulk or send spam. Legitimate
          use of supported APIs and connected tools remains welcome within service limits.
        </p>
      </section>
      <section>
        <h2>Usernames and short links</h2>
        <p>
          A username gives you an address on Wya, not ownership of a trademark or a permanent right
          to that address. Current usernames are exclusive while assigned. When you rename a space,
          the old username becomes available for someone else to claim; any fallback redirect can
          stop working.
        </p>
        <p>
          Short links depend on their items remaining available. Renaming a link does not preserve
          the previous address unless it is retained as an alias. Hidden or removed items no longer
          resolve normally. Check your published addresses after changes.
        </p>
      </section>
      <section>
        <h2>Connected tools and other websites</h2>
        <p>
          Connecting an app authorizes it to act within the permissions shown to you. Tools with
          write access can change your spaces. Review changes and disconnect access you no longer
          want. AI-generated suggestions and edits can be wrong.
        </p>
        <p>
          External links, game information, and image hosts are operated by others. A listing on Wya
          is not an endorsement or a guarantee of safety, accuracy, availability, or ownership.
          Those services have their own terms.
        </p>
      </section>
      <section>
        <h2>Availability and changes</h2>
        <p>
          Wya is an evolving service. Features, limits, and availability may change, and outages or
          data loss are possible. Keep your own copies of content you cannot afford to lose.
          Analytics are approximate and may be incomplete or affected by automated traffic; they are
          not verified business results.
        </p>
        <p>
          These terms do not authorize a charge or subscription. Any future paid offering needs
          separately disclosed pricing and your agreement before charging you.
        </p>
      </section>
      <section>
        <h2>Safety, suspension, and leaving</h2>
        <p>
          Wya may restrict content or access where reasonably necessary to address abuse, security
          risks, legal obligations, or violations of these terms. Where appropriate and legally
          permitted, the operator will explain the action. You can request review at{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>.
        </p>
        <p>
          You can stop using Wya and revoke connected apps at any time. Request account deletion at{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>; there is currently no self-service
          account-deletion flow.
        </p>
      </section>
      <section>
        <h2>Your legal rights</h2>
        <p>
          Nothing in these terms excludes rights or obligations that applicable law does not allow
          to be excluded, including mandatory consumer protections. This draft does not select a
          governing law, exclusive court, arbitration requirement, or financial liability cap; any
          additional provisions need review once the jurisdictions served are confirmed.
        </p>
      </section>
      <section>
        <h2>Updates and contact</h2>
        <p>
          The final terms will identify their effective date. Questions and reports can be sent to{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>. Material changes should be
          communicated through the service, with renewed agreement where required. Until
          publication, the signup links provide access to these drafts for review and do not record
          acceptance of a finalized agreement.
        </p>
      </section>
    </LegalPage>
  );
}
