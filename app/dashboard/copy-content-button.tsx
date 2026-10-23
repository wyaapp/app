'use client';

import { useEffect, useState } from 'react';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { useTranslation } from '../components/language-provider';

export function CopyContentButton({
  label,
  disabled,
  onCopy,
}: {
  label: string;
  disabled: boolean;
  onCopy: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      disabled={disabled || copying}
      onClick={async () => {
        setCopying(true);
        try {
          setCopied(await onCopy());
        } finally {
          setCopying(false);
        }
      }}
    >
      {copied ? (
        <CheckIcon weight="regular" aria-hidden="true" size={16} />
      ) : (
        <CopyIcon weight="regular" aria-hidden="true" size={16} />
      )}
      <span aria-live="polite">{t(copied ? 'Copied' : label)}</span>
    </button>
  );
}
