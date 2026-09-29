const STORAGE_PREFIX = 'sahukar-data';

export function getStorageKey(userId) {
  return `${STORAGE_PREFIX}-${userId}`;
}

export function readLedger(userId) {
  try {
    if (typeof localStorage === 'undefined') {
      return { customers: [], payments: [] };
    }

    const raw = localStorage.getItem(getStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : { customers: [], payments: [] };

    return {
      customers: Array.isArray(parsed?.customers) ? parsed.customers : [],
      payments: Array.isArray(parsed?.payments) ? parsed.payments : []
    };
  } catch {
    return { customers: [], payments: [] };
  }
}

export function writeLedger(userId, ledger) {
  const nextValue = {
    customers: Array.isArray(ledger?.customers) ? ledger.customers : [],
    payments: Array.isArray(ledger?.payments) ? ledger.payments : []
  };

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(nextValue));
  }

  return nextValue;
}

export function migrateLegacyLedger(userId, legacyLedger) {
  const nextValue = {
    customers: Array.isArray(legacyLedger?.customers) ? legacyLedger.customers : [],
    payments: Array.isArray(legacyLedger?.payments) ? legacyLedger.payments : []
  };

  return writeLedger(userId, nextValue);
}

export function deleteCustomerFiles() {
  return true;
}

export function exportBackup(userId) {
  const ledger = readLedger(userId);
  return {
    format: 'sahukar-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    ledger
  };
}
