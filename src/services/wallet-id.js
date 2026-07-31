// Wallet ID — the holder's shareable wallet identifier (plan §3.1).
//
// Format: AEG-XXXX-XXXX-XXXX
//   * 16 significant characters, Crockford Base32 (excludes I, L, O, U so it can
//     be read aloud or retyped without ambiguity)
//   * the final character is a mod-37 check symbol that catches single-character
//     typos and adjacent transpositions
//   * dashes are cosmetic; parsing is case- and dash-insensitive
//
// It is an identifier, not a secret: possession of a Wallet ID alone proves
// nothing, because sensitive operations additionally require the wallet's
// device key.

const crypto = require('node:crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32 (no I/L/O/U)
const PREFIX = 'AEG';
const BODY_LENGTH = 15; // 15 random chars + 1 check symbol = 16 significant
const TOTAL_LENGTH = 16;
const CHECK_MODULUS = 37;

// Normalize user input: strip dashes/spaces, uppercase, and map the characters
// people commonly substitute (I/L -> 1, O -> 0, U -> V).
function normalizeInput(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/^AEG/, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

// Position-weighted sum modulo a prime (37). Because 37 is prime and larger than
// the alphabet, every single-character substitution and every adjacent
// transposition changes the residue, so both are always detected.
//
// Returns null when the residue lands outside the 32-character alphabet; such
// bodies are simply not issued (generateWalletId resamples), which keeps every
// Wallet ID inside the unambiguous Crockford alphabet.
function checkSymbol(body) {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const value = ALPHABET.indexOf(body[index]);
    if (value === -1) {
      return null;
    }
    sum += value * (index + 2);
  }

  const residue = sum % CHECK_MODULUS;
  return residue < ALPHABET.length ? ALPHABET[residue] : null;
}

function formatWalletId(significant) {
  const groups = significant.match(/.{1,4}/g) || [];
  return `${PREFIX}-${groups.join('-')}`;
}

function randomBody() {
  let body = '';
  while (body.length < BODY_LENGTH) {
    // Rejection sampling keeps the distribution uniform across the alphabet.
    for (const byte of crypto.randomBytes(BODY_LENGTH)) {
      if (body.length >= BODY_LENGTH) {
        break;
      }
      if (byte < 256 - (256 % ALPHABET.length)) {
        body += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return body;
}

function generateWalletId() {
  // Resample the rare bodies whose check residue falls outside the alphabet.
  for (;;) {
    const body = randomBody();
    const check = checkSymbol(body);
    if (check !== null) {
      return formatWalletId(`${body}${check}`);
    }
  }
}

// Returns the canonical `AEG-XXXX-XXXX-XXXX` form, or null when the input is not
// a structurally valid Wallet ID (wrong length, bad characters, bad check symbol).
function parseWalletId(value) {
  const significant = normalizeInput(value);
  if (significant.length !== TOTAL_LENGTH) {
    return null;
  }
  if (![...significant].every((character) => ALPHABET.includes(character))) {
    return null;
  }

  const body = significant.slice(0, BODY_LENGTH);
  const expected = checkSymbol(body);
  if (expected === null || expected !== significant[BODY_LENGTH]) {
    return null;
  }

  return formatWalletId(significant);
}

function isValidWalletId(value) {
  return parseWalletId(value) !== null;
}

module.exports = {
  ALPHABET,
  PREFIX,
  TOTAL_LENGTH,
  checkSymbol,
  formatWalletId,
  generateWalletId,
  isValidWalletId,
  parseWalletId
};
