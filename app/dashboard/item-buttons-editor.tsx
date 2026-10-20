'use client';
import { useTranslation } from '@/app/components/language-provider';

import { Plus, X } from 'lucide-react';
import { MAX_ITEM_BUTTONS, type ItemButtonDraft } from '@/lib/item-buttons';

export function ItemButtonsEditor({
  buttons,
  onChange,
  busy,
  formId,
  label = 'Buttons',
  hint,
  minButtons = 0,
  newLabel = 'Learn more',
  newDestination = '',
}: {
  formId?: string;
  buttons: ItemButtonDraft[];
  onChange: (buttons: ItemButtonDraft[]) => void;
  busy: boolean;
  label?: string;
  hint: string;
  minButtons?: number;
  newLabel?: string;
  newDestination?: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset disabled={busy} className="project-buttons-editor">
      <legend>{t(label)}</legend>
      <div className="item-button-fields">
        <p className="field-description">{t(hint)}</p>
        {buttons.map((button, index) => (
          <div className="project-button-editor" key={index}>
            <label>
              {t('Button') + ' '}
              {index + 1} {' ' + t('label')}
              <input
                form={formId}
                value={button.label}
                required
                maxLength={30}
                onChange={(event) =>
                  onChange(
                    buttons.map((item, i) =>
                      i === index ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              {t('Button') + ' '}
              {index + 1} {' ' + t('URL')}
              <input
                form={formId}
                type="url"
                value={button.destination}
                required
                maxLength={2048}
                placeholder="https://…"
                onChange={(event) =>
                  onChange(
                    buttons.map((item, i) =>
                      i === index ? { ...item, destination: event.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Remove button {number}', { number: index + 1 })}
              disabled={buttons.length <= minButtons}
              onClick={() => onChange(buttons.filter((_, i) => i !== index))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button-small button-light"
          disabled={buttons.length >= MAX_ITEM_BUTTONS}
          onClick={() =>
            onChange([...buttons, { label: t(newLabel), destination: newDestination }])
          }
        >
          <Plus size={15} />
          {t('Add button')}
        </button>
      </div>
    </fieldset>
  );
}
