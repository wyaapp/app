import Big from 'big.js';

// A private constructor keeps calculator precision separate from other Big users.
const Decimal = Big();
Decimal.DP = 130;
Decimal.RM = Decimal.roundHalfUp;
Decimal.NE = -7;
Decimal.PE = 12;

export const CALCULATOR_DIGIT_LIMIT = 12;
const INTERNAL_PRECISION = 24;
const EXPONENT_LIMIT = 99;

export type CalculatorOperator = '+' | '-' | '*' | '/';
export type CalculatorAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'operator'; operator: CalculatorOperator }
  | { type: 'equals' }
  | { type: 'percent' }
  | { type: 'negate' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'clear-entry' };

export type CalculatorState = {
  /** A decimal string, optionally in scientific notation; never localized. */
  display: string;
  expression: string;
  error: null | 'division-by-zero' | 'out-of-range';
  value: string;
  accumulator: string | null;
  operator: CalculatorOperator | null;
  phase: 'entry' | 'operator' | 'result';
  replaceEntry: boolean;
  lastOperator: CalculatorOperator | null;
  lastOperand: string | null;
};

export const initialCalculatorState: CalculatorState = {
  display: '0',
  expression: '',
  error: null,
  value: '0',
  accumulator: null,
  operator: null,
  phase: 'entry',
  replaceEntry: false,
  lastOperator: null,
  lastOperand: null,
};

function displayNumber(value: Big): string {
  return value.eq('0') ? '0' : value.prec(CALCULATOR_DIGIT_LIMIT).toString();
}

function checkedNumber(value: Big): Big {
  const rounded = value.prec(INTERNAL_PRECISION);
  if (!rounded.eq('0') && Math.abs(rounded.e) > EXPONENT_LIMIT) {
    throw new RangeError('out-of-range');
  }
  return rounded;
}

function calculate(left: string, operator: CalculatorOperator, right: string): Big {
  const a = new Decimal(left);
  const b = new Decimal(right);
  if (operator === '/' && b.eq('0')) throw new RangeError('division-by-zero');
  switch (operator) {
    case '+':
      return checkedNumber(a.plus(b));
    case '-':
      return checkedNumber(a.minus(b));
    case '*':
      return checkedNumber(a.times(b));
    case '/': {
      const value = a.div(b);
      // Division has bounded decimal precision; do not present underflow as zero.
      if (!a.eq('0') && value.eq('0')) throw new RangeError('out-of-range');
      return checkedNumber(value);
    }
  }
}

function failedCalculation(error: unknown, expression: string): CalculatorState {
  return {
    ...initialCalculatorState,
    expression,
    error:
      error instanceof RangeError && error.message === 'division-by-zero'
        ? 'division-by-zero'
        : 'out-of-range',
    phase: 'result',
    replaceEntry: true,
  };
}

function entryState(state: CalculatorState): CalculatorState {
  return state.error || state.phase === 'result' ? initialCalculatorState : state;
}

function enterDisplay(state: CalculatorState, display: string): CalculatorState {
  return {
    ...state,
    display,
    value: new Decimal(display).toString(),
    phase: 'entry',
    replaceEntry: false,
    lastOperator: null,
    lastOperand: null,
  };
}

/** Standard calculator behavior: operations are evaluated from left to right. */
export function calculatorReducer(
  state: CalculatorState,
  action: CalculatorAction,
): CalculatorState {
  if (action.type === 'clear') return initialCalculatorState;

  if (action.type === 'digit') {
    if (!/^[0-9]$/.test(action.digit)) return state;
    const next = entryState(state);
    let display = next.replaceEntry ? '0' : next.display;
    if (display === '0' || display === '-0') {
      display = `${display.startsWith('-') ? '-' : ''}${action.digit}`;
    } else {
      // Count entered digits, including fractional zeros, to bound the input width.
      const digits = display.replace(/[^0-9]/g, '').replace(/^0/, '');
      if (digits.length >= CALCULATOR_DIGIT_LIMIT) return state;
      display += action.digit;
    }
    return enterDisplay(next, display);
  }

  if (action.type === 'decimal') {
    const next = entryState(state);
    const display = next.replaceEntry ? '0' : next.display;
    if (display.includes('.')) return next;
    return enterDisplay(next, `${display}.`);
  }

  if (action.type === 'clear-entry') {
    if (state.error || state.phase === 'result') return initialCalculatorState;
    return enterDisplay(state, '0');
  }

  if (action.type === 'backspace') {
    if (state.error) return initialCalculatorState;
    if (state.phase !== 'entry' || state.replaceEntry) return state;
    const display = state.display.slice(0, -1);
    return enterDisplay(state, !display || display === '-' ? '0' : display);
  }

  if (state.error) return state;

  if (action.type === 'operator') {
    let value = new Decimal(state.value);
    if (state.operator && state.accumulator !== null && state.phase !== 'operator') {
      try {
        value = calculate(state.accumulator, state.operator, state.value);
      } catch (error) {
        return failedCalculation(error, `${state.expression} ${state.display}`);
      }
    }
    const display = displayNumber(value);
    return {
      ...state,
      display,
      value: value.toString(),
      accumulator: value.toString(),
      operator: action.operator,
      expression: `${display} ${action.operator}`,
      phase: 'operator',
      replaceEntry: true,
      lastOperator: null,
      lastOperand: null,
    };
  }

  if (action.type === 'equals') {
    const operator = state.operator ?? state.lastOperator;
    const left = state.accumulator ?? state.value;
    const right = state.operator ? state.value : state.lastOperand;
    if (!operator || right === null) return state;
    const expression = `${displayNumber(new Decimal(left))} ${operator} ${displayNumber(new Decimal(right))} =`;
    try {
      const value = calculate(left, operator, right);
      return {
        ...initialCalculatorState,
        display: displayNumber(value),
        value: value.toString(),
        expression,
        phase: 'result',
        replaceEntry: true,
        lastOperator: operator,
        lastOperand: right,
      };
    } catch (error) {
      return failedCalculation(error, expression);
    }
  }

  if (action.type === 'negate') {
    if (state.phase === 'operator') return enterDisplay(state, '-0');
    if (!state.replaceEntry) {
      const display = state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`;
      return enterDisplay(state, display);
    }
    const value = new Decimal(state.value).neg();
    return {
      ...state,
      display: displayNumber(value),
      value: value.toString(),
      expression: state.operator ? state.expression : '',
      lastOperator: null,
      lastOperand: null,
    };
  }

  if (action.type === 'percent') {
    try {
      let value = new Decimal(state.value).div('100');
      if (state.accumulator !== null && (state.operator === '+' || state.operator === '-')) {
        value = new Decimal(state.accumulator).times(value);
      }
      value = checkedNumber(value);
      return {
        ...state,
        display: displayNumber(value),
        value: value.toString(),
        expression: state.operator ? state.expression : `${state.display}%`,
        phase: state.operator ? 'entry' : 'result',
        replaceEntry: true,
        lastOperator: null,
        lastOperand: null,
      };
    } catch (error) {
      return failedCalculation(error, `${state.display}%`);
    }
  }

  return state;
}
