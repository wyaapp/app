'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
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
      {copied ? <Check size={16} /> : <Copy size={16} />}
      <span aria-live="polite">{t(copied ? 'Copied' : label)}</span>
    </button>
  );
}
