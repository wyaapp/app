'use client';
import { useTranslation } from '@/app/components/language-provider';
import { useFileCardId } from '@/app/components/document-card-context';

export const parseAliases = (value: string) =>
  value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((alias) => alias.toLowerCase());
export function AliasField({
  value,
  onChange,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const fileId = useFileCardId();
  if (fileId) return null;
  return (
    <label>
      {t('Extra short URLs (aliases)')}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        maxLength={410}
        placeholder="code, gh"
      />
      <span className="field-description">
        {t(
          "Up to 10 extra slugs, separated by commas. They open this same item's destination and stay attached when its main slug changes.",
        )}
      </span>
    </label>
  );
}
