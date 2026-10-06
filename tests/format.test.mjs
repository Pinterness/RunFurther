// Display formats shared by every screen: one way to show money and dates across the site.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime, formatVnd } from '../src/lib/format.js';

describe('formatVnd', () => {
  it('groups thousands with dots and appends đ without a space, like the existing pages', () => {
    assert.equal(formatVnd(50_000), '50.000đ');
    assert.equal(formatVnd(100_000_000), '100.000.000đ');
    assert.equal(formatVnd(0), '0đ');
  });
});

describe('formatDateTime', () => {
  it('returns an empty string when there is no date', () => {
    assert.equal(formatDateTime(null), '');
    assert.equal(formatDateTime(undefined), '');
  });

  it('formats real dates in Vietnamese', () => {
    assert.match(formatDateTime('2026-10-05T03:04:05Z'), /2026/);
  });
});
