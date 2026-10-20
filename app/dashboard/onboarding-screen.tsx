'use client';
import { useTranslation } from '@/app/components/language-provider';

import type { Onboarding } from '@/lib/onboarding';
import { OnboardingForm } from './onboarding-form';

export function OnboardingScreen({ onSaved }: { onSaved: (value: Onboarding) => void }) {
  const { t } = useTranslation();
  return (
    <main className="onboarding-layout">
      <section className="onboarding-screen" aria-labelledby="onboarding-title">
        <div className="onboarding-heading">
          <h1 id="onboarding-title">{t('Help shape Wya')}</h1>
        </div>
        <OnboardingForm initial={null} onSaved={onSaved} />
      </section>
    </main>
  );
}
