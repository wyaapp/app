'use client';

import { DropdownMenu } from 'radix-ui';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CodeIcon } from '@phosphor-icons/react/dist/ssr/Code';
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { normalizeCodeLanguage, syntaxLanguages } from '@/lib/syntax-highlighting';
import { useTranslation } from '../language-provider';

const labels: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  jsonc: 'JSONC',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  markdown: 'Markdown',
  shellscript: 'Shell',
  python: 'Python',
  sql: 'SQL',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  lua: 'Lua',
  vue: 'Vue',
  svelte: 'Svelte',
};

export function CodeLanguageMenu({
  language,
  disabled,
  onChange,
}: {
  language: string | null;
  disabled: boolean;
  onChange: (language: string | null) => void;
}) {
  const { t } = useTranslation();
  const normalized = normalizeCodeLanguage(language);
  const value = normalized ?? language ?? '';
  const options = [
    { value: '', label: t('Plain text') },
    ...(language && !normalized ? [{ value: language, label: language }] : []),
    ...syntaxLanguages.map((value) => ({ value, label: labels[value] })),
  ];
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger disabled={disabled}>
        <CodeIcon size={16} aria-hidden="true" />
        {t('Code language')}
        <CaretRightIcon size={14} className="rich-block-menu-chevron" aria-hidden="true" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          className="rich-block-actions-menu rich-code-language-menu"
          sideOffset={4}
          collisionPadding={12}
          aria-label={t('Code language')}
        >
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next || null)}>
            {options.map((option) => (
              <DropdownMenu.RadioItem key={option.value} value={option.value} disabled={disabled}>
                <span className="rich-media-size-check">
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon size={16} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {option.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
