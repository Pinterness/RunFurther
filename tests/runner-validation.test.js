const { test } = require('node:test');
const assert = require('node:assert/strict');
const { birthdayBounds, birthdayError, calendarDate, ageOn, needsBirthdayConfirmation } = require('../src/lib/runnerValidation.cjs');
const { nationalities, normalizeNationality } = require('../src/lib/nationalities.cjs');

test('Birth dates use the Vietnam calendar and reject invalid or out-of-range dates', () => {
  const options = { now: new Date('2026-10-12T18:00:00Z') };
  assert.equal(calendarDate(options.now), '2026-10-13');
  assert.deepEqual(birthdayBounds(options), { min: '1900-01-01', max: '2019-10-13' });
  for (const value of ['2026-10-14', '1899-12-31', '1900-02-29', '2025-02-30', '12/10/2000', false, 0, [], {}]) {
    assert.ok(birthdayError(value, options), String(value));
  }
  for (const value of [undefined, null, '', '1900-01-01', '2000-02-29', '2019-10-13']) assert.equal(birthdayError(value, options), '');
  assert.ok(birthdayError('2019-10-14', options));
  assert.ok(birthdayError('', { ...options, required: true }));
});

test('Minimum race age includes the birthday itself, handles leap days and never allows a future birth', () => {
  const options = { now: new Date('2026-10-13T12:00:00Z'), raceDate: '2026-10-20T23:00:00Z', minAge: 18 };
  assert.equal(birthdayBounds(options).max, '2008-10-21');
  assert.equal(birthdayError('2008-10-21', options), '');
  assert.ok(birthdayError('2008-10-22', options));
  assert.ok(birthdayError('', options));
  assert.equal(birthdayBounds({ ...options, raceDate: '2028-02-29T02:00:00Z' }).max, '2010-02-28');
  assert.ok(birthdayError('2010-03-01', { ...options, raceDate: '2028-02-29T02:00:00Z' }));
  assert.equal(birthdayBounds({ ...options, raceDate: '2100-10-21T02:00:00Z' }).max, '2019-10-13');
});

test('Completed ages 7 through 50 are accepted; 51+ requires a date-specific confirmation', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  assert.equal(ageOn('2019-10-15', now), 7);
  assert.equal(ageOn('2019-10-16', now), 6);
  assert.equal(needsBirthdayConfirmation('1975-10-16', now), false);
  assert.equal(needsBirthdayConfirmation('1975-10-15', now), true);
  assert.equal(ageOn('2000-02-29', new Date('2026-02-28T12:00:00Z')), 25);
  assert.equal(ageOn('2000-02-29', new Date('2026-03-01T12:00:00Z')), 26);
});

test('Country choices are unique, normalize known legacy names and reject invented nationalities', () => {
  assert.equal(nationalities.length, 249);
  assert.equal(new Set(nationalities.map(country => country.code)).size, nationalities.length);
  assert.equal(new Set(nationalities.map(country => country.name)).size, nationalities.length);
  assert.equal(normalizeNationality('  Viet Nam '), 'Việt Nam');
  assert.equal(normalizeNationality('JPN'), 'Nhật Bản');
  for (const value of ['Atlantis', 'Quốc gia tự nhập', '', [], null, 123]) assert.equal(normalizeNationality(value), '');
});
