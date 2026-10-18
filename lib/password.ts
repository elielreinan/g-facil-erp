const REQUIRED_PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};':\"\\|<>?,./`~";

export function isStrongPassword(value: string): boolean {
  return value.length >= 12
    && value.length <= 128
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
    && [...REQUIRED_PASSWORD_SYMBOLS].some((character) => value.includes(character));
}
