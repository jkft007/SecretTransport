// Passphrase strength estimate. Deliberately conservative: it assumes people choose words and
// patterns, not uniformly random characters. It is a guide, not a proof.

export type Level = 'none' | 'weak' | 'ok' | 'strong';
export const WEAK_BELOW = 50;
export const STRONG_FROM = 70;

const COMMON = new Set(
  (
    'password 123456 12345678 123456789 1234567890 qwerty qwertyuiop abc123 monkey letmein dragon 111111 000000 baseball iloveyou ' +
    'trustno1 sunshine master welcome shadow ashley football jesus michael ninja mustang password1 password123 passw0rd admin login ' +
    'princess starwars freedom whatever hello charlie batman superman secret secretpassword changeme summer winter spring autumn ' +
    'qazwsx 1q2w3e4r access flower killer pass test guest root toor abcdef abcd1234 987654321 pokemon naruto cheese purple tigger ' +
    'soccer hunter2 correcthorsebatterystaple opensesame letmein123 welcome1 iloveyou1 football1 monkey123 dragon123 master123 ' +
    'internet computer samsung whatever1 default myspace1 jordan23 liverpool chelsea arsenal london america password2 asdfgh asdfghjkl zxcvbnm'
  ).split(' '),
);

const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'abcdefghijklmnopqrstuvwxyz'];

const LEET: Record<string, string> = { '@': 'a', '4': 'a', '3': 'e', '1': 'l', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };

function deLeet(s: string): string {
  return [...s.toLowerCase()].map((c) => LEET[c] ?? c).join('');
}

function looksLikeWord(w: string): boolean {
  if (!/^\p{L}{2,14}$/u.test(w)) return false;
  const letters = [...w.toLowerCase()];
  const vowels = letters.filter((c) => 'aeiouyáéíóúàèìòùäëïöüåæø'.includes(c)).length;
  if (vowels / letters.length < 0.2) return false; // "qmxn" style strings are random, not words
  return !/[^aeiouy]{5,}/i.test(w);
}

function repeatedBlockLength(s: string): number {
  for (let n = 1; n <= s.length / 2; n++) {
    if (s.length % n === 0 && s === s.slice(0, n).repeat(s.length / n)) return n;
  }
  return s.length;
}

/** Characters that sit inside runs like "abc", "321" or a keyboard row, which add little. */
function sequentialChars(s: string): number {
  const low = s.toLowerCase();
  let covered = 0;
  for (let i = 0; i + 2 < low.length; ) {
    const a = low.charCodeAt(i);
    const d = low.charCodeAt(i + 1) - a;
    let j = i + 1;
    if (Math.abs(d) === 1) while (j + 1 < low.length && low.charCodeAt(j + 1) - low.charCodeAt(j) === d) j++;
    const run = j - i + 1;
    if (Math.abs(d) === 1 && run >= 3) {
      covered += run - 1;
      i = j;
    } else i++;
  }
  for (const row of KEYBOARD) {
    for (let n = 4; n <= Math.min(row.length, low.length); n++) {
      for (let k = 0; k + n <= low.length; k++) {
        const sub = low.slice(k, k + n);
        if (row.includes(sub) || [...row].reverse().join('').includes(sub)) {
          covered = Math.max(covered, n - 1);
        }
      }
    }
  }
  return covered;
}

export function passphraseBits(input: string): number {
  const p = input.normalize('NFKC');
  if (!p) return 0;
  const lower = p.toLowerCase();
  const stripped = deLeet(p).replace(/[^a-z]/g, '');
  if (COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(lower.replace(/[^a-z0-9]/g, ''))) return Math.min(10, p.length);

  // A few separated words (a passphrase): count each word as ~10 bits.
  const parts = p.split(/[\s\-_.,:;/+]+/).filter(Boolean);
  if (parts.length >= 2 && parts.every(looksLikeWord)) {
    const extra = /\d/.test(p) ? 3 : 0;
    return parts.length * 10 + extra;
  }

  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 33;
  if (/[^\x00-\x7f]/.test(p)) pool += 60;
  pool = Math.max(pool, 2);

  let eff = repeatedBlockLength(p) === p.length ? [...p].length : repeatedBlockLength(p);
  eff = Math.min(eff, new Set(p).size * 3);
  eff = Math.max(0, eff - sequentialChars(p));
  return Math.round(eff * Math.log2(pool) * 0.8);
}

export function strength(p: string, generated = false): { bits: number; level: Level } {
  if (!p) return { bits: 0, level: 'none' };
  const bits = generated ? Math.max(passphraseBits(p), 90) : passphraseBits(p);
  return { bits, level: bits < WEAK_BELOW ? 'weak' : bits < STRONG_FROM ? 'ok' : 'strong' };
}
