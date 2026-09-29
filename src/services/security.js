const PIN_RECORD_PREFIX = 'pbkdf2-sha256$';
const PBKDF2_ITERATIONS = 310000;
const WEB_STORAGE_PREFIX = 'sahukar-pin-v2';
let secureStorageReady;

function userKey(userId, kind) {
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new TypeError('A valid authenticated user ID is required.');
  }
  return `ledger_pin${kind === 'attempts' ? '_attempts' : ''}:${userId.toLowerCase()}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function derivePinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256));
}

async function getSecureStorage() {
  if (!secureStorageReady) {
    secureStorageReady = (async () => {
      const module = await import('@aparajita/capacitor-secure-storage');
      await module.SecureStorage.setKeyPrefix('sahukar-ledger-pro');
      return module.SecureStorage;
    })();
  }
  return secureStorageReady;
}

async function storeValue(userId, kind, value) {
  const key = userKey(userId, kind);
  if (typeof window !== 'undefined' && window.electronAPI?.storeSecret) {
    return window.electronAPI.storeSecret(userId, key, value);
  }
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
    return (await getSecureStorage()).setItem(key, value);
  }
  if (typeof localStorage !== 'undefined') localStorage.setItem(`${WEB_STORAGE_PREFIX}:${key}`, value);
  else throw new Error('Secure PIN storage is unavailable.');
}

async function getValue(userId, kind) {
  const key = userKey(userId, kind);
  if (typeof window !== 'undefined' && window.electronAPI?.getSecret) return window.electronAPI.getSecret(userId, key);
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) return (await getSecureStorage()).getItem(key);
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(`${WEB_STORAGE_PREFIX}:${key}`);
}

async function removeValue(userId, kind) {
  const key = userKey(userId, kind);
  if (typeof window !== 'undefined' && window.electronAPI?.removeSecret) return window.electronAPI.removeSecret(userId, key);
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) return (await getSecureStorage()).removeItem(key);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(`${WEB_STORAGE_PREFIX}:${key}`);
}

export async function hashPin(pin) {
  const cleaned = String(pin ?? '').trim();
  if (!/^\d{4}$/.test(cleaned)) throw new TypeError('PIN must contain exactly four digits.');
  if (!globalThis.crypto?.subtle) throw new Error('Secure PIN hashing is unavailable in this runtime.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(cleaned, salt);
  return `${PIN_RECORD_PREFIX}${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

async function verifyPinRecord(pin, record) {
  const match = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*)$/.exec(String(record || ''));
  if (!match || Number(match[1]) < 100000 || Number(match[1]) > 1000000) return false;
  const candidateKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const candidate = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(match[2]), iterations: Number(match[1]) }, candidateKey, 256));
  const expected = base64ToBytes(match[3]);
  if (candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) difference |= candidate[index] ^ expected[index];
  return difference === 0;
}

export const securePin = {
  async store(userId, pin) {
    await storeValue(userId, 'pin', await hashPin(pin));
    await removeValue(userId, 'attempts');
  },

  async get(userId) {
    return getValue(userId, 'pin');
  },

  async validate(userId, pin) {
    const failures = JSON.parse(await getValue(userId, 'attempts') || '{"count":0,"lockedUntil":0}');
    if (Number(failures.lockedUntil) > Date.now()) return false;
    const expected = await getValue(userId, 'pin');
    const valid = expected ? await verifyPinRecord(pin, expected) : false;
    if (valid) {
      await removeValue(userId, 'attempts');
      return true;
    }
    const count = Number(failures.count || 0) + 1;
    const delay = count < 5 ? 0 : Math.min(15 * 60 * 1000, 30 * 1000 * (2 ** Math.min(count - 5, 5)));
    await storeValue(userId, 'attempts', JSON.stringify({ count, lockedUntil: Date.now() + delay }));
    return false;
  },

  async clear(userId) {
    await removeValue(userId, 'pin');
    await removeValue(userId, 'attempts');
  }
};

export function hasValidPinRecord(record) {
  return typeof record === 'string' && /^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/.test(record);
}

export const hashPinValue = hashPin;
