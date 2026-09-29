const safeInvoke = async (name, ...args) => {
  if (typeof window === 'undefined' || !window.electronAPI || typeof window.electronAPI[name] !== 'function') {
    throw new Error('Electron local storage is unavailable.');
  }

  return window.electronAPI[name](...args);
};

export async function ensureUserStorage(userId) {
  return safeInvoke('initializeUserStorage', userId);
}

export async function closeUserStorage(userId) {
  return safeInvoke('closeUserStorage', userId);
}

export async function readLedger(userId) {
  const ledger = await safeInvoke('getLedger', userId);
  if (!ledger || !Array.isArray(ledger.customers) || !Array.isArray(ledger.payments)) throw new Error('Electron returned an invalid ledger.');
  return ledger;
}

export async function writeLedger(userId, ledger) {
  const nextValue = {
    customers: Array.isArray(ledger?.customers) ? ledger.customers : [],
    payments: Array.isArray(ledger?.payments) ? ledger.payments : []
  };

  return safeInvoke('saveLedger', userId, nextValue);
}

export async function deleteCustomerFiles(userId, customerId) {
  return safeInvoke('deleteCustomerFiles', userId, customerId);
}

export async function exportBackup(userId) {
  return safeInvoke('exportBackup', userId);
}

export async function restoreBackup(userId) {
  return safeInvoke('restoreBackup', userId);
}
