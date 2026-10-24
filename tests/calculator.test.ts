import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculatorReducer,
  initialCalculatorState,
  type CalculatorAction,
  type CalculatorOperator,
  type CalculatorState,
} from '../lib/calculator.ts';

function press(keys: string, initial = initialCalculatorState): CalculatorState {
  return [...keys].reduce((state, key) => {
    let action: CalculatorAction;
    if (/^[0-9]$/.test(key)) action = { type: 'digit', digit: key };
    else if (['+', '-', '*', '/'].includes(key)) {
      action = { type: 'operator', operator: key as CalculatorOperator };
    } else {
      const actions = {
        '.': 'decimal',
        '=': 'equals',
        '%': 'percent',
        n: 'negate',
        b: 'backspace',
        c: 'clear',
        e: 'clear-entry',
      } as const;
      const type = actions[key as keyof typeof actions];
      if (!type) throw new Error(`Unknown test key ${key}`);
      action = { type };
    }
    return calculatorReducer(state, action);
  }, initial);
}

test('decimal arithmetic is exact for entered decimals', () => {
  assert.equal(press('0.1+0.2=').display, '0.3');
  assert.equal(press('0.3-0.1=').display, '0.2');
  assert.equal(press('1.25*8=').display, '10');
  assert.equal(press('123.45/100=').display, '1.2345');
});

test('standard mode calculates sequentially and replaces pending operators', () => {
  assert.equal(press('2+3*4=').display, '20');
  assert.equal(press('8+-2=').display, '6');
  assert.equal(press('8+*/2=').display, '4');
  assert.equal(press('2+3=').expression, '2 + 3 =');
});

test('equals repeats the last operand and operator', () => {
  assert.equal(press('2+3===').display, '11');
  assert.equal(press('64/2===').display, '8');
  assert.equal(press('5+=').display, '10');
  assert.equal(press('5+==').display, '15');
  assert.equal(press('8===').display, '8');
});

test('new digits start a fresh calculation and operators continue a result', () => {
  assert.equal(press('2+3=4').display, '4');
  assert.equal(press('2+3=4').expression, '');
  assert.equal(press('2+3=*4=').display, '20');
  assert.equal(press('2+3=.5').display, '0.5');
});

test('percent uses the accumulated total for addition and subtraction', () => {
  assert.equal(press('200+10%=').display, '220');
  assert.equal(press('200-10%=').display, '180');
  assert.equal(press('200*10%=').display, '20');
  assert.equal(press('200/10%=').display, '2000');
  assert.equal(press('200+10%==').display, '240');
  assert.equal(press('50%').display, '0.5');
  assert.equal(press('200+10%*2=').display, '440');
  assert.equal(press('200+10%5=').display, '205');
});

test('sign changes support a negative operand without erasing the pending operator', () => {
  assert.equal(press('12n').display, '-12');
  assert.equal(press('12nn').display, '12');
  assert.equal(press('5+n2=').display, '3');
  assert.equal(press('5-8=').display, '-3');
  assert.equal(press('5-8=n*2=').display, '6');
  assert.equal(press('n.5').display, '-0.5');
  assert.equal(press('0n=').value, '0');
});

test('backspace edits input while clear entry preserves the calculation', () => {
  assert.equal(press('12.34b').display, '12.3');
  assert.equal(press('1nb').display, '0');
  assert.equal(press('12+34e5=').display, '17');
  assert.equal(press('12+e=').display, '12');
  assert.equal(press('12+3=b').display, '15');
  assert.equal(press('12+3=c').display, '0');
  assert.equal(press('12+3=c').expression, '');
});

test('entry is bounded, preserves decimal intent, and rejects invalid digits', () => {
  assert.equal(press('0001').display, '1');
  assert.equal(press('1.00').display, '1.00');
  assert.equal(press('1..2.3').display, '1.23');
  assert.equal(press('1234567890123').display, '123456789012');
  assert.equal(press('0.1234567890123').display, '0.123456789012');
  assert.equal(press('0.0000000000001').display, '0.000000000000');
  assert.equal(
    calculatorReducer(initialCalculatorState, { type: 'digit', digit: '12' }),
    initialCalculatorState,
  );
});

test('computed numbers fit the display without losing internal calculation precision', () => {
  assert.equal(press('1/3=').display, '0.333333333333');
  assert.equal(press('1/3=*3=').display, '1');
  assert.equal(press('999999999999*999999999999=').display, '9.99999999998e+23');
  assert.equal(press('1/10000000=').display, '1e-7');
  assert.equal(press('1/10000000=2').display, '2');
  assert.equal(press('1/10000000=.5').display, '0.5');
});

test('division by zero gives an explicit error and allows immediate recovery', () => {
  const broken = press('42/0=');
  assert.equal(broken.error, 'division-by-zero');
  assert.equal(broken.expression, '42 / 0 =');
  assert.equal(press('+n%=', broken).error, 'division-by-zero');
  assert.equal(press('7+2=', broken).display, '9');
  assert.equal(press('7+2=', broken).error, null);
  assert.deepEqual(press('b', broken), initialCalculatorState);
  assert.deepEqual(press('e', broken), initialCalculatorState);
  assert.equal(press('.5', broken).display, '0.5');
  assert.equal(press('0/0=').error, 'division-by-zero');
  assert.equal(press('1/0+').error, 'division-by-zero');
});

test('very large and very small results report their range limit instead of freezing', () => {
  const large = press(`999999999999*999999999999${'='.repeat(9)}`);
  assert.equal(large.error, 'out-of-range');
  const small = press(`1/999999999999${'='.repeat(10)}`);
  assert.equal(small.error, 'out-of-range');
  assert.equal(press('9*9=', large).display, '81');
  assert.equal(press('c', small).error, null);
  const underflow = calculatorReducer(
    {
      ...initialCalculatorState,
      value: '1e+99',
      accumulator: '1e-99',
      operator: '/',
    },
    { type: 'equals' },
  );
  assert.equal(underflow.error, 'out-of-range');
});

test('calculations do not mutate the initial state or previous history', () => {
  const before = structuredClone(initialCalculatorState);
  const first = press('23+');
  const firstSnapshot = structuredClone(first);
  press('4=', first);
  assert.deepEqual(initialCalculatorState, before);
  assert.deepEqual(first, firstSnapshot);
});
