import { getTranslator } from '@/lib/i18n/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '../components/legal-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: t('Terms of Use'),
    description: t('The rules for using Wya.'),
    robots: { index: false, follow: true },
  };
}
export default async function TermsPage() {
  const t = await getTranslator();
  return (
    <LegalPage title={t('Terms of Use')} intro={t('A few ground rules for using Wya.')}>
      <section>
        <h2>{t('About Wya')}</h2>
        <p>
          {t(
            'Wya helps you share links, projects, and interests in one place. It is operated by Alex Castro. Questions or reports can be sent to',
          )}{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>
          {t('. Our')} <Link href="/privacy">{t('Privacy Policy')}</Link>{' '}
          {' ' + t('explains how we handle personal information.')}
        </p>
      </section>
      <section>
        <h2>{t('Your account')}</h2>
        <p>
          {t(
            'You must be at least 18, able to accept these terms, and use an email account you control. Do not create accounts for someone under 18. Keep sign-in codes and connected-app access secure, and contact us if someone accesses your account without permission.',
          )}
        </p>
      </section>
      <section>
        <h2>{t('Your content')}</h2>
        <p>
          {t(
            'Your content stays yours. You give us permission to store, format, and display it as needed to run Wya and follow your instructions. Only share content you have the right to use. You are responsible for what you publish and where your links lead.',
          )}
        </p>
        <p>
          {t(
            'Public content can be copied or indexed by others. Removing it from your page does not immediately erase saved history, backups, or copies outside Wya.',
          )}
        </p>
      </section>
      <section>
        <h2>{t('Use it responsibly')}</h2>
        <p>
          {t(
            "Do not use Wya for scams, phishing, malware, spam, deceptive impersonation, harassment, child exploitation, or unlawful content. Respect other people's privacy and intellectual property.",
          )}
        </p>
        <p>
          {t(
            'Do not break into accounts, bypass security or usage limits, disrupt the service, or collect usernames in bulk. Supported tools and automation are welcome within our limits.',
          )}
        </p>
      </section>
      <section>
        <h2>{t('Usernames and links')}</h2>
        <p>
          {t(
            "Usernames are not a permanent ownership right. If you change yours, someone else can claim the old one and its redirect may stop working. Changing a link's URL also retires the old address unless you keep it as an alias. Hidden or deleted items stop working as short links, so check your addresses after making changes.",
          )}
        </p>
      </section>
      <section>
        <h2>{t('Connected apps and other websites')}</h2>
        <p>
          {t(
            'Apps such as ChatGPT can read or change your spaces according to the permissions you grant. Review their changes and disconnect apps you no longer want. AI can make mistakes.',
          )}
        </p>
        <p>
          {t(
            'We do not control or endorse external websites, game information, or hosted images. Those services have their own rules and may change or become unavailable.',
          )}
        </p>
      </section>
      <section>
        <h2>{t('Availability and access')}</h2>
        <p>
          {t(
            'Wya is evolving. Features and limits may change, and outages or data loss can happen. Keep copies of anything important. Analytics are estimates, not guaranteed results. Any future paid features will require clear pricing and your agreement before charging you.',
          )}
        </p>
        <p>
          {t(
            'We may restrict content or accounts to address abuse, security risks, legal requirements, or violations of these terms. Where appropriate and permitted, we will explain why. Contact us to ask for a review.',
          )}
        </p>
      </section>
      <section>
        <h2>{t('Leaving and your rights')}</h2>
        <p>
          {t('You can stop using Wya at any time. To delete your account, email')}{' '}
          <a href="mailto:contact@wya.im">contact@wya.im</a>
          {t('. Nothing in these terms takes away rights that the law protects.')}
        </p>
        <p>
          {t(
            'The final terms will include an effective date. We will communicate important changes through the service and ask for renewed agreement where required.',
          )}
        </p>
      </section>
    </LegalPage>
  );
}
