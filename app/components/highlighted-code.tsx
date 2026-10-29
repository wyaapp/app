'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { highlightCode, normalizeCodeLanguage } from '@/lib/syntax-highlighting';

type HighlightResult = {
  source: string;
  language: string;
  tokens: Awaited<ReturnType<typeof highlightCode>>;
};

/** Enhance the existing code text without changing its markup or dimensions while loading. */
export function HighlightedCode({
  source,
  language,
  className,
  codeClassName,
  tabIndex,
}: {
  source: string;
  language?: string | null;
  className?: string;
  codeClassName?: string;
  tabIndex?: number;
}) {
  const normalizedLanguage = normalizeCodeLanguage(language);
  const [result, setResult] = useState<HighlightResult | null>(null);

  useEffect(() => {
    if (!normalizedLanguage) return;
    let active = true;
    void highlightCode(source, normalizedLanguage)
      .then((tokens) => {
        if (active) setResult({ source, language: normalizedLanguage, tokens });
      })
      .catch(() => {
        // Unsupported syntax or a failed chunk load leaves the source readable.
      });
    return () => {
      active = false;
    };
  }, [source, normalizedLanguage]);

  const tokens =
    result?.source === source && result.language === normalizedLanguage ? result.tokens : null;
  let content: ReactNode = source;
  if (tokens?.length) {
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const token of tokens) {
      if (token.from > cursor) parts.push(source.slice(cursor, token.from));
      parts.push(
        <span key={`${token.from}:${token.to}`} style={{ color: token.color }}>
          {source.slice(token.from, token.to)}
        </span>,
      );
      cursor = token.to;
    }
    if (cursor < source.length) parts.push(source.slice(cursor));
    content = parts;
  }

  return (
    <pre className={className} tabIndex={tabIndex}>
      <code className={codeClassName ?? (language ? `language-${language}` : undefined)}>
        {content}
      </code>
    </pre>
  );
}
