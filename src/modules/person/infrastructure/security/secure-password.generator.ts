// Adaptador del puerto PasswordGenerator con node:crypto (aleatoriedad criptográfica).
import crypto from 'node:crypto';
import type { PasswordGenerator } from '../../application/ports/password-generator.port';

const LENGTH = 12;
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*';
const ALL = UPPERCASE + LOWERCASE + NUMBERS + SYMBOLS;

const pick = (chars: string) => chars[crypto.randomInt(0, chars.length)]!;

/** Una de cada clase garantizada, el resto al azar y todo mezclado (Fisher-Yates). */
export function generateSecurePassword(): string {
  const chars = [pick(UPPERCASE), pick(LOWERCASE), pick(NUMBERS), pick(SYMBOLS)];
  while (chars.length < LENGTH) {
    chars.push(pick(ALL));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

export const securePasswordGenerator: PasswordGenerator = { generate: generateSecurePassword };
