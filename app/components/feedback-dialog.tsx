'use client';

import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { useTranslation } from './language-provider';
import { FeedbackForm, useFeedbackForm } from './feedback-form';

export function FeedbackDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const feedback = useFeedbackForm();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) feedback.reset();
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" className="text-link">
          {t('Feedback')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="icon-dialog-overlay" />
        <Dialog.Content className="icon-dialog feedback-dialog">
          <div className="icon-dialog-heading">
            <Dialog.Title>{t('What could be better?')}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label={t('Close feedback')}>
                <XIcon weight="regular" aria-hidden="true" size={22} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="icon-dialog-description">
            {t('Found a bug or have an idea? Tell us.')}
          </Dialog.Description>
          <FeedbackForm feedback={feedback} onDone={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
