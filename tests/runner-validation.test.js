const { test } = require('node:test');
const assert = require('node:assert/strict');
const { birthdayBounds, birthdayError, calendarDate } = require('../src/lib/runnerValidation.cjs');

test('Birth dates use the Vietnam calendar and reject invalid or out-of-range dates', () => {
  const options = { now: new Date('2026-10-12T18:00:00Z') };
  assert.equal(calendarDate(options.now), '2026-10-13');
  assert.deepEqual(birthdayBounds(options), { min: '1900-01-01', max: '2026-10-13' });
  for (const value of ['2026-10-14', '1899-12-31', '1900-02-29', '2025-02-30', '12/10/2000', false, 0, [], {}]) {
    assert.ok(birthdayError(value, options), String(value));
  }
  for (const value of [undefined, null, '', '1900-01-01', '2000-02-29', '2026-10-13']) assert.equal(birthdayError(value, options), '');
});

test('Minimum race age includes the birthday itself, handles leap days and never allows a future birth', () => {
  const options = { now: new Date('2026-10-13T12:00:00Z'), raceDate: '2026-10-20T23:00:00Z', minAge: 18 };
  assert.equal(birthdayBounds(options).max, '2008-10-21');
  assert.equal(birthdayError('2008-10-21', options), '');
  assert.ok(birthdayError('2008-10-22', options));
  assert.ok(birthdayError('', options));
  assert.equal(birthdayBounds({ ...options, raceDate: '2028-02-29T02:00:00Z' }).max, '2010-02-28');
  assert.ok(birthdayError('2010-03-01', { ...options, raceDate: '2028-02-29T02:00:00Z' }));
  assert.equal(birthdayBounds({ ...options, raceDate: '2100-10-21T02:00:00Z' }).max, '2026-10-13');
});
