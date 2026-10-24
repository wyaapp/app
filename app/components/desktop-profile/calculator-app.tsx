'use client';

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { BackspaceIcon } from '@phosphor-icons/react/dist/ssr/Backspace';
import { DivideIcon } from '@phosphor-icons/react/dist/ssr/Divide';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { MinusIcon } from '@phosphor-icons/react/dist/ssr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import { PlusMinusIcon } from '@phosphor-icons/react/dist/ssr/PlusMinus';
import { EqualsIcon } from '@phosphor-icons/react/dist/ssr/Equals';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import {
  calculatorReducer,
  initialCalculatorState,
  type CalculatorAction,
  type CalculatorOperator,
} from '@/lib/calculator';
import { useTranslation } from '../language-provider';

const operatorIcons = { '/': DivideIcon, '*': XIcon, '-': MinusIcon, '+': PlusIcon };
const operatorLabels = { '/': 'Divide', '*': 'Multiply', '-': 'Subtract', '+': 'Addition' };

function actionKey(action: CalculatorAction) {
  if (action.type === 'digit') return action.digit;
  if (action.type === 'operator') return action.operator;
  return action.type === 'clear-entry' ? 'clear' : action.type;
}

export function CalculatorApp({ active }: { active: boolean }) {
  const { t, locale } = useTranslation();
  const [state, dispatch] = useReducer(calculatorReducer, initialCalculatorState);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const app = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyAttempt = useRef(0);
  const decimal = locale === 'pt-BR' ? ',' : '.';
  const display = state.display.replace('.', decimal);
  const expression = state.expression
    .replaceAll('*', '×')
    .replaceAll('/', '÷')
    .replaceAll('.', decimal);
  const error =
    state.error === 'division-by-zero'
      ? t('Cannot divide by zero.')
      : state.error
        ? t('Number is too large or too small.')
        : '';

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => app.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (pressTimer.current) clearTimeout(pressTimer.current);
      copyAttempt.current += 1;
    },
    [],
  );

  function input(action: CalculatorAction, keyboard = false) {
    copyAttempt.current += 1;
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopied(false);
    setCopyError(false);
    if (keyboard) {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      setPressedKey(actionKey(action));
      pressTimer.current = setTimeout(() => setPressedKey(null), 140);
    }
    dispatch(action);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!active || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing)
      return;
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
    if (event.key === 'Enter' && (event.target as HTMLElement).closest('.calculator-copy')) return;
    let action: CalculatorAction | undefined;
    if (/^\d$/.test(event.key)) action = { type: 'digit', digit: event.key };
    else if (event.key === '.' || event.key === ',') action = { type: 'decimal' };
    else if (['+', '-', '*', '/'].includes(event.key))
      action = { type: 'operator', operator: event.key as CalculatorOperator };
    else if (event.key === 'Enter' || event.key === '=') action = { type: 'equals' };
    else if (event.key === 'Backspace') action = { type: 'backspace' };
    else if (event.key === 'Delete') action = { type: 'clear-entry' };
    else if (event.key === 'Escape' || event.key.toLowerCase() === 'c') action = { type: 'clear' };
    else if (event.key === '%') action = { type: 'percent' };
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    input(action, true);
  }
  async function copyResult() {
    const attempt = ++copyAttempt.current;
    try {
      await navigator.clipboard.writeText(display);
      if (attempt !== copyAttempt.current) return;
      setCopied(true);
      setCopyError(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      if (attempt !== copyAttempt.current) return;
      setCopyError(true);
    }
  }
  function operator(value: CalculatorOperator) {
    const Icon = operatorIcons[value];
    return (
      <button
        type="button"
        className="calculator-key is-operator"
        data-pressed={pressedKey === value || undefined}
        aria-pressed={state.operator === value}
        aria-label={t(operatorLabels[value])}
        title={`${t(operatorLabels[value])} (${value})`}
        onClick={() => input({ type: 'operator', operator: value })}
      >
        <Icon size={24} weight="regular" aria-hidden="true" />
      </button>
    );
  }
  function digit(value: string) {
    return (
      <button
        key={value}
        type="button"
        className="calculator-key is-digit"
        data-pressed={pressedKey === value || undefined}
        onClick={() => input({ type: 'digit', digit: value })}
      >
        {value}
      </button>
    );
  }

  return (
    <div
      ref={app}
      className="calculator-app"
      role="group"
      aria-label={t('Calculator')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="calculator-display" data-error={!!state.error || undefined}>
        <div className="calculator-expression-row">
          <button
            type="button"
            className="calculator-copy"
            data-copied={copied || undefined}
            aria-label={copied ? t('Copied') : t('Copy result')}
            title={copied ? t('Copied') : t('Copy result')}
            disabled={!!state.error}
            onClick={() => void copyResult()}
          >
            {copied ? (
              <CheckIcon size={18} aria-hidden="true" />
            ) : (
              <CopyIcon size={18} aria-hidden="true" />
            )}
          </button>
          <span className="calculator-expression" title={error || expression}>
            {error || expression || '\u00a0'}
          </span>
        </div>
        <output
          className="calculator-result"
          aria-label={t('Result')}
          aria-live="polite"
          aria-atomic="true"
          style={
            { '--calculator-digits': (state.error ? t('Error') : display).length } as CSSProperties
          }
        >
          {state.error ? t('Error') : display}
        </output>
      </div>
      <div className="calculator-keypad" role="group" aria-label={t('Calculator keypad')}>
        <button
          type="button"
          className="calculator-key is-utility"
          data-pressed={pressedKey === 'clear' || undefined}
          aria-label={t('Clear all')}
          title={`${t('Clear all')} (Esc)`}
          onClick={() => input({ type: 'clear' })}
        >
          AC
        </button>
        <button
          type="button"
          className="calculator-key is-utility"
          data-pressed={pressedKey === 'backspace' || undefined}
          aria-label={t('Backspace')}
          title={`${t('Backspace')} (⌫)`}
          onClick={() => input({ type: 'backspace' })}
        >
          <BackspaceIcon size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="calculator-key is-utility"
          data-pressed={pressedKey === 'percent' || undefined}
          aria-label={t('Percent')}
          title={t('Percent')}
          onClick={() => input({ type: 'percent' })}
        >
          %
        </button>
        {operator('/')}
        {['7', '8', '9'].map(digit)}
        {operator('*')}
        {['4', '5', '6'].map(digit)}
        {operator('-')}
        {['1', '2', '3'].map(digit)}
        {operator('+')}
        <button
          type="button"
          className="calculator-key"
          data-pressed={pressedKey === 'negate' || undefined}
          aria-label={t('Change sign')}
          title={t('Change sign')}
          onClick={() => input({ type: 'negate' })}
        >
          <PlusMinusIcon size={22} aria-hidden="true" />
        </button>
        {digit('0')}
        <button
          type="button"
          className="calculator-key"
          data-pressed={pressedKey === 'decimal' || undefined}
          aria-label={t('Decimal point')}
          title={t('Decimal point')}
          onClick={() => input({ type: 'decimal' })}
        >
          {decimal}
        </button>
        <button
          type="button"
          className="calculator-key is-equals"
          data-pressed={pressedKey === 'equals' || undefined}
          aria-label={t('Equals')}
          title={`${t('Equals')} (Enter)`}
          onClick={() => input({ type: 'equals' })}
        >
          <EqualsIcon size={26} aria-hidden="true" />
        </button>
      </div>
      {copyError && (
        <p className="calculator-hint" role="status">
          {t('Select the result to copy it.')}
        </p>
      )}
    </div>
  );
}
