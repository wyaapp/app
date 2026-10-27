'use client';

import { useState, type ComponentProps } from 'react';
import { DomainSettings } from './domain-settings';
import { useTranslation } from '../components/language-provider';
import {
  createLocalDomainPreview,
  type LocalDomainScenario,
  type LocalDomainOutcome,
} from '@/lib/local-domain-preview';

const scenarios: [LocalDomainScenario, string][] = [
  ['empty', 'No domain'],
  ['ownership', 'Verify ownership'],
  ['https', 'Enable HTTPS'],
  ['routing', 'Connect address'],
  ['active', 'Connected'],
  ['suspended', 'Suspended'],
  ['removing', 'Disconnecting domain…'],
  ['unavailable', 'Service unavailable'],
  ['free', 'Free plan'],
];
const ignoreMockDomain = () => {};

// Imported only by the local simulated-account development build. The real
// component receives an isolated transport; window.fetch is never patched.
export default function LocalDomainSettings(
  props: Omit<ComponentProps<typeof DomainSettings>, 'request' | 'onChanged'>,
) {
  const { t } = useTranslation();
  const [preview] = useState(() => createLocalDomainPreview());
  const [scenario, setScenario] = useState<LocalDomainScenario>('ownership');
  const [outcome, setOutcome] = useState<LocalDomainOutcome>('advance');
  const [generation, setGeneration] = useState(0);

  function loadScenario(next: LocalDomainScenario) {
    preview.setScenario(next);
    setScenario(next);
    setGeneration((value) => value + 1);
  }

  return (
    <>
      <aside className="window-section domain-local-preview" aria-label={t('Local simulation')}>
        <strong>{t('Local simulation')}</strong>
        <p>{t('Sample data only. DNS, your account and your real domain are not changed.')}</p>
        <details>
          <summary>{t('Test different states')}</summary>
          <div className="domain-local-controls">
            <label>
              {t('Load scenario')}
              <select
                value={scenario}
                onChange={(event) => loadScenario(event.target.value as LocalDomainScenario)}
              >
                {scenarios.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Simulated action result')}
              <select
                value={outcome}
                onChange={(event) => {
                  const value = event.target.value as LocalDomainOutcome;
                  preview.setOutcome(value);
                  setOutcome(value);
                }}
              >
                <option value="advance">{t('Success / advance step')}</option>
                <option value="unchanged">{t('Check: still waiting')}</option>
                <option value="fail">{t('Request error')}</option>
              </select>
            </label>
            <button
              className="button button-small"
              type="button"
              onClick={() => {
                preview.reset();
                setOutcome('advance');
                setGeneration((value) => value + 1);
              }}
            >
              {t('Reset simulation')}
            </button>
          </div>
        </details>
      </aside>
      <div className="window-section-divider domain-local-content">
        <DomainSettings
          key={generation}
          {...props}
          request={preview.request}
          onChanged={ignoreMockDomain}
        />
      </div>
    </>
  );
}
