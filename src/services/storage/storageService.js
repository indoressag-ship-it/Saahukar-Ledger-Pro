import { readLedger as readWebLedger, writeLedger as writeWebLedger, migrateLegacyLedger as migrateLegacyWebLedger, exportBackup as exportWebBackup } from './webStorage';
import { ensureUserStorage as ensureElectronStorage, closeUserStorage as closeElectronStorage, readLedger as readElectronLedger, writeLedger as writeElectronLedger, deleteCustomerFiles as deleteElectronCustomerFiles, exportBackup as exportElectronBackup, restoreBackup as restoreElectronBackup } from './electronStorage';
import { ensureUserStorage as ensureMobileStorage, readLedger as readMobileLedger, writeLedger as writeMobileLedger, deleteCustomerFiles as deleteMobileCustomerFiles, exportBackup as exportMobileBackup } from './mobileStorage';

const getPlatform = () => {
  if (typeof window === 'undefined') {
    return { isElectron: false, isAndroid: false, isWeb: true };
  }

  const electron = Boolean(window.electronAPI && typeof window.electronAPI.getLedger === 'function');
  const capacitorNative = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const android = capacitorNative || /Android/i.test(navigator.userAgent);

  return {
    isElectron: electron,
    isAndroid: android,
    isWeb: !electron && !android
  };
};

export const storagePlatform = getPlatform();

const ensureUserStorage = async (userId) => {
  if (storagePlatform.isElectron) {
    return ensureElectronStorage(userId);
  }
  if (storagePlatform.isAndroid) {
    return ensureMobileStorage(userId);
  }
  return Promise.resolve(true);
};

const readLedger = async (userId) => {
  if (storagePlatform.isElectron) {
    return readElectronLedger(userId);
  }
  if (storagePlatform.isAndroid) {
    return readMobileLedger(userId);
  }
  return readWebLedger(userId);
};

const closeUserStorage = async (userId) => {
  if (storagePlatform.isElectron) return closeElectronStorage(userId);
  return true;
};

const writeLedger = async (userId, ledger) => {
  if (storagePlatform.isElectron) {
    return writeElectronLedger(userId, ledger);
  }
  if (storagePlatform.isAndroid) {
    return writeMobileLedger(userId, ledger);
  }
  return writeWebLedger(userId, ledger);
};

const migrateLegacyLedger = async (userId, legacyLedger) => {
  if (storagePlatform.isElectron) {
    return writeElectronLedger(userId, legacyLedger);
  }
  if (storagePlatform.isAndroid) {
    return writeMobileLedger(userId, legacyLedger);
  }
  return migrateLegacyWebLedger(userId, legacyLedger);
};

const deleteCustomerFiles = async (userId, customerId) => {
  if (storagePlatform.isElectron) {
    return deleteElectronCustomerFiles(userId, customerId);
  }
  if (storagePlatform.isAndroid) {
    return deleteMobileCustomerFiles(userId, customerId);
  }
  return true;
};

const exportBackup = async (userId) => {
  if (storagePlatform.isElectron) {
    return exportElectronBackup(userId);
  }
  if (storagePlatform.isAndroid) {
    return exportMobileBackup(userId);
  }
  return exportWebBackup(userId);
};

const restoreBackup = async (userId, backup) => {
  if (storagePlatform.isElectron) {
    return restoreElectronBackup(userId);
  }
  if (storagePlatform.isAndroid) {
    return null;
  }
  return writeWebLedger(userId, backup?.ledger || { customers: [], payments: [] });
};

export const storageService = {
  ensureUserStorage,
  closeUserStorage,
  readLedger,
  writeLedger,
  migrateLegacyLedger,
  deleteCustomerFiles,
  exportBackup,
  restoreBackup
};
