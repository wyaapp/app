import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportRetryClock, reportRetrySeconds } from '../lib/report-retry.ts';

test('report uses API delay and rounds up rather than allowing early retry', () => {
  assert.equal(reportRetrySeconds(75.2, '120'), 76);
  assert.equal(reportRetrySeconds(86400, null), 86400);
});

test('report falls back to Retry-After seconds or its HTTP date', () => {
  const now = Date.UTC(2026, 9, 26, 16, 0, 0);
  assert.equal(reportRetrySeconds(undefined, ' 90 '), 90);
  assert.equal(reportRetrySeconds(-1, '0.5'), 1);
  assert.equal(reportRetrySeconds(NaN, 'Mon, 26 Oct 2026 16:02:00 GMT', now), 120);
});

test('report handles missing, malformed, expired and zero cooldowns conservatively', () => {
  const now = Date.UTC(2026, 9, 26);
  for (const value of [undefined, null, 0, -2, NaN, Infinity, '5']) {
    assert.equal(reportRetrySeconds(value, null, now), 60);
  }
  for (const header of ['', 'bad', '0', '-5', 'Sun, 25 Oct 2026 23:59:59 GMT']) {
    assert.equal(reportRetrySeconds(undefined, header, now), 60);
  }
});

test('report countdown is readable for short and daily limits', () => {
  assert.equal(reportRetryClock(0), '0:00');
  assert.equal(reportRetryClock(1.1), '0:02');
  assert.equal(reportRetryClock(65), '1:05');
  assert.equal(reportRetryClock(3605), '1:00:05');
  assert.equal(reportRetryClock(86400), '24:00:00');
});
