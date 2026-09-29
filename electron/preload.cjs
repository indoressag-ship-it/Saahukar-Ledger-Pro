const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  initializeUserStorage: (userId) => ipcRenderer.invoke('ledger:initialize', userId),
  closeUserStorage: (userId) => ipcRenderer.invoke('ledger:close', userId),
  getLedger: (userId) => ipcRenderer.invoke('ledger:read', userId),
  saveLedger: (userId, ledger) => ipcRenderer.invoke('ledger:write', userId, ledger),
  exportBackup: (userId) => ipcRenderer.invoke('ledger:backup-export', userId),
  restoreBackup: (userId) => ipcRenderer.invoke('ledger:backup-restore', userId),
  deleteCustomerFiles: (userId, customerId) => ipcRenderer.invoke('ledger:delete-customer-files', userId, customerId),
  storeSecret: (userId, key, value) => ipcRenderer.invoke('ledger:secret-store', userId, key, value),
  getSecret: (userId, key) => ipcRenderer.invoke('ledger:secret-get', userId, key),
  removeSecret: (userId, key) => ipcRenderer.invoke('ledger:secret-remove', userId, key)
}));