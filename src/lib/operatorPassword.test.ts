import { describe, it, expect, afterEach } from 'vitest';
import {
  operatorPasswordConfigured,
  operatorPasswordTooShort,
  MIN_OPERATOR_PASSWORD_LENGTH,
} from './env';

/**
 * Password sign-in is opt-in, and a too-short value falls back silently to
 * emailed links. Silent fallbacks are exactly the kind of thing that wastes
 * an afternoon, so the two states are pinned here.
 */

const ORIGINAL = process.env.OPERATOR_PASSWORD;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OPERATOR_PASSWORD;
  else process.env.OPERATOR_PASSWORD = ORIGINAL;
});

describe('operator password configuration', () => {
  it('is off when the variable is unset', () => {
    delete process.env.OPERATOR_PASSWORD;
    expect(operatorPasswordConfigured()).toBe(false);
    expect(operatorPasswordTooShort()).toBe(false);
  });

  it('is off, and says why, when the value is too short', () => {
    process.env.OPERATOR_PASSWORD = 'a'.repeat(MIN_OPERATOR_PASSWORD_LENGTH - 1);
    expect(operatorPasswordConfigured()).toBe(false);
    expect(operatorPasswordTooShort()).toBe(true);
  });

  it('is on at exactly the minimum length', () => {
    process.env.OPERATOR_PASSWORD = 'a'.repeat(MIN_OPERATOR_PASSWORD_LENGTH);
    expect(operatorPasswordConfigured()).toBe(true);
    expect(operatorPasswordTooShort()).toBe(false);
  });

  it('treats an empty string as unset rather than as a password', () => {
    process.env.OPERATOR_PASSWORD = '';
    expect(operatorPasswordConfigured()).toBe(false);
    expect(operatorPasswordTooShort()).toBe(false);
  });
});
