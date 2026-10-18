import { describe, expect, it } from 'vitest';
import { isStrongPassword } from '../lib/password';

describe('isStrongPassword', () => {
  it('requires length and mixed character classes', () => {
    expect(isStrongPassword('Abcdefghij1!')).toBe(true);
    expect(isStrongPassword('Abcdefgh1!')).toBe(false);
    expect(isStrongPassword('abcdefghijkl1!')).toBe(false);
    expect(isStrongPassword('Abcdefghijkl!')).toBe(false);
    expect(isStrongPassword('Abcdefghijkl1')).toBe(false);
    expect(isStrongPassword(`A${'b'.repeat(126)}1!`)).toBe(false);
  });
});
