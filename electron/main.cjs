const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const userDatabases = new Map();

function validateUserId(userId) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw new TypeError('A valid authenticated user ID is required.');
  }
  return userId.toLowerCase();
}

function validateId(id, label) {
  const normalized = String(id ?? '');
  if (!ID_PATTERN.test(normalized)) throw new TypeError(`Invalid ${label}.`);
  return normalized;
}

function getUserDirectory(userId) {
  return path.join(app.getPath('userData'), 'users', validateUserId(userId));
}

function getDatabase(userId) {
  const normalizedUserId = validateUserId(userId);
  const openDatabase = userDatabases.get(normalizedUserId);
  if (openDatabase) return openDatabase;

  const userDirectory = getUserDirectory(normalizedUserId);
  fs.mkdirSync(path.join(userDirectory, 'customers'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(userDirectory, 'backups'), { recursive: true, mode: 0o700 });

  const database = new DatabaseSync(path.join(userDirectory, 'ledger.db'));
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      gov_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      extra_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
      principal_paise INTEGER NOT NULL DEFAULT 0,
      interest_rate REAL NOT NULL DEFAULT 0,
      loan_date TEXT NOT NULL,
      collateral TEXT NOT NULL DEFAULT '',
      gold_weight REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      payment_date TEXT NOT NULL,
      total_paid_paise INTEGER NOT NULL DEFAULT 0,
      interest_paid_paise INTEGER NOT NULL DEFAULT 0,
      principal_paid_paise INTEGER NOT NULL DEFAULT 0,
      remaining_principal_paise INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      extra_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payments_customer_date_idx ON payments(customer_id, payment_date DESC);
    CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name COLLATE NOCASE);
    PRAGMA user_version = 1;
  `);
  userDatabases.set(normalizedUserId, database);
  return database;
}

function moneyToPaise(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new TypeError('Financial values must be finite numbers.');
  return Math.round(amount * 100);
}

function paiseToMoney(value) {
  return Number(value || 0) / 100;
}

function decodeId(value) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value;
}

function readLedger(userId) {
  const database = getDatabase(userId);
  const customers = database.prepare(`
    SELECT customers.*, loans.principal_paise, loans.interest_rate, loans.loan_date,
      loans.collateral, loans.gold_weight, loans.notes AS loan_notes
    FROM customers LEFT JOIN loans ON loans.customer_id = customers.id
    ORDER BY customers.created_at DESC
  `).all().map((row) => {
    const extra = JSON.parse(row.extra_json || '{}');
    return {
      ...extra,
      id: decodeId(row.id),
      name: row.name,
      mobile: row.mobile,
      address: row.address,
      gov_id: row.gov_id,
      principal: paiseToMoney(row.principal_paise),
      interest_rate: row.interest_rate ?? 0,
      loan_date: row.loan_date ?? '',
      collateral: row.collateral ?? '',
      gold_weight: row.gold_weight ?? 0,
      notes: row.loan_notes ?? '',
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });
  const payments = database.prepare('SELECT * FROM payments ORDER BY created_at DESC').all().map((row) => ({
    ...JSON.parse(row.extra_json || '{}'),
    id: decodeId(row.id),
    customer_id: decodeId(row.customer_id),
    payment_date: row.payment_date,
    total_paid: paiseToMoney(row.total_paid_paise),
    interest_paid: paiseToMoney(row.interest_paid_paise),
    principal_paid: paiseToMoney(row.principal_paid_paise),
    remaining_principal: paiseToMoney(row.remaining_principal_paise),
    created_at: row.created_at
  }));
  return { customers, payments };
}

function saveLedger(userId, ledger) {
  const normalizedUserId = validateUserId(userId);
  const database = getDatabase(normalizedUserId);
  const customers = Array.isArray(ledger?.customers) ? ledger.customers : [];
  const payments = Array.isArray(ledger?.payments) ? ledger.payments : [];
  const now = new Date().toISOString();
  const customerIds = new Set(customers.map((customer) => validateId(customer.id, 'customer ID')));

  database.exec('BEGIN IMMEDIATE');
  try {
    const upsertCustomer = database.prepare(`
      INSERT INTO customers (id, name, mobile, address, gov_id, created_at, updated_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, mobile=excluded.mobile,
        address=excluded.address, gov_id=excluded.gov_id, updated_at=excluded.updated_at,
        extra_json=excluded.extra_json
    `);
    const upsertLoan = database.prepare(`
      INSERT INTO loans (id, customer_id, principal_paise, interest_rate, loan_date, collateral, gold_weight, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(customer_id) DO UPDATE SET principal_paise=excluded.principal_paise,
        interest_rate=excluded.interest_rate, loan_date=excluded.loan_date,
        collateral=excluded.collateral, gold_weight=excluded.gold_weight,
        notes=excluded.notes, updated_at=excluded.updated_at
    `);
    const upsertPayment = database.prepare(`
      INSERT INTO payments (id, customer_id, payment_date, total_paid_paise, interest_paid_paise,
        principal_paid_paise, remaining_principal_paise, created_at, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id, payment_date=excluded.payment_date,
        total_paid_paise=excluded.total_paid_paise, interest_paid_paise=excluded.interest_paid_paise,
        principal_paid_paise=excluded.principal_paid_paise,
        remaining_principal_paise=excluded.remaining_principal_paise, extra_json=excluded.extra_json
    `);

    for (const customer of customers) {
      const id = validateId(customer.id, 'customer ID');
      const { principal, interest_rate, loan_date, collateral, gold_weight, notes, ...extra } = customer;
      const existing = database.prepare('SELECT created_at FROM customers WHERE id = ?').get(id);
      const createdAt = customer.created_at || existing?.created_at || now;
      upsertCustomer.run(id, String(customer.name || ''), String(customer.mobile || ''), String(customer.address || ''), String(customer.gov_id || ''), createdAt, now, JSON.stringify(extra));
      upsertLoan.run(id, id, moneyToPaise(principal), Number(interest_rate || 0), String(loan_date || ''), String(collateral || ''), Number(gold_weight || 0), String(notes || ''), now);
      fs.mkdirSync(path.join(getUserDirectory(normalizedUserId), 'customers', id, 'photos'), { recursive: true, mode: 0o700 });
      fs.mkdirSync(path.join(getUserDirectory(normalizedUserId), 'customers', id, 'documents'), { recursive: true, mode: 0o700 });
      fs.mkdirSync(path.join(getUserDirectory(normalizedUserId), 'customers', id, 'receipts'), { recursive: true, mode: 0o700 });
    }

    const existingCustomerIds = database.prepare('SELECT id FROM customers').all().map((row) => row.id);
    for (const id of existingCustomerIds) {
      if (!customerIds.has(id)) database.prepare('DELETE FROM customers WHERE id = ?').run(id);
    }

    const paymentIds = new Set();
    for (const payment of payments) {
      const id = validateId(payment.id, 'payment ID');
      const customerId = validateId(payment.customer_id, 'payment customer ID');
      if (!customerIds.has(customerId)) throw new Error('Payment refers to a customer outside this ledger.');
      paymentIds.add(id);
      const { total_paid, interest_paid, principal_paid, remaining_principal, ...extra } = payment;
      const existing = database.prepare('SELECT created_at FROM payments WHERE id = ?').get(id);
      upsertPayment.run(id, customerId, String(payment.payment_date || ''), moneyToPaise(total_paid), moneyToPaise(interest_paid), moneyToPaise(principal_paid), moneyToPaise(remaining_principal), payment.created_at || existing?.created_at || now, JSON.stringify(extra));
    }
    const existingPaymentIds = database.prepare('SELECT id FROM payments').all().map((row) => row.id);
    for (const id of existingPaymentIds) {
      if (!paymentIds.has(id)) database.prepare('DELETE FROM payments WHERE id = ?').run(id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return readLedger(normalizedUserId);
}

function collectCustomerFiles(userId) {
  const root = path.join(getUserDirectory(userId), 'customers');
  const files = [];
  let totalBytes = 0;

  function visit(directory, customerId) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Backup cannot include symbolic links.');
      if (entry.isDirectory()) {
        visit(fullPath, customerId);
      } else if (entry.isFile()) {
        const relativePath = path.relative(path.join(root, customerId), fullPath).split(path.sep).join('/');
        if (!/^(photos|documents|receipts)\/[a-zA-Z0-9_.-]{1,180}$/.test(relativePath)) throw new Error('Customer file path is invalid.');
        const stat = fs.statSync(fullPath);
        totalBytes += stat.size;
        if (stat.size > 25 * 1024 * 1024 || totalBytes > 250 * 1024 * 1024) throw new Error('Backup files exceed the supported size limit.');
        files.push({ customerId, relativePath, data: fs.readFileSync(fullPath).toString('base64') });
      }
    }
  }

  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Backup cannot include symbolic links.');
      if (entry.isDirectory()) visit(path.join(root, entry.name), validateId(entry.name, 'customer ID'));
    }
  }
  return files;
}

function createBackupDocument(userId) {
  const normalizedUserId = validateUserId(userId);
  const ledger = readLedger(normalizedUserId);
  return {
    format: 'sahukar-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    userId: normalizedUserId,
    ledger,
    files: collectCustomerFiles(normalizedUserId)
  };
}

function validateBackupDocument(userId, backup) {
  const normalizedUserId = validateUserId(userId);
  if (!backup || backup.format !== 'sahukar-backup' || backup.version !== 1 || backup.userId !== normalizedUserId) {
    throw new Error('This backup is invalid, unsupported, or belongs to a different account.');
  }
  if (!Array.isArray(backup.ledger?.customers) || !Array.isArray(backup.ledger?.payments) || !Array.isArray(backup.files)) {
    throw new Error('Backup contents are incomplete.');
  }
  const customerIds = new Set(backup.ledger.customers.map((customer) => validateId(customer.id, 'customer ID')));
  const filePaths = new Set();
  for (const file of backup.files) {
    const customerId = validateId(file.customerId, 'backup customer ID');
    if (!customerIds.has(customerId) || typeof file.data !== 'string' || !/^(photos|documents|receipts)\/[a-zA-Z0-9_.-]{1,180}$/.test(file.relativePath)) {
      throw new Error('Backup contains an invalid customer file.');
    }
    const key = `${customerId}/${file.relativePath}`;
    if (filePaths.has(key)) throw new Error('Backup contains duplicate file paths.');
    filePaths.add(key);
    const size = Buffer.byteLength(file.data, 'base64');
    if (size > 25 * 1024 * 1024) throw new Error('A backup file exceeds the supported size limit.');
  }
  for (const payment of backup.ledger.payments) {
    if (!customerIds.has(validateId(payment.customer_id, 'payment customer ID'))) throw new Error('Backup contains an unlinked payment.');
  }
  return normalizedUserId;
}

function writeBackupFile(destination, backup) {
  fs.writeFileSync(destination, JSON.stringify(backup), { flag: 'wx', mode: 0o600 });
}

function pruneSafetyBackups(userId) {
  const directory = path.join(getUserDirectory(userId), 'backups');
  const backups = fs.readdirSync(directory)
    .filter((name) => name.startsWith('safety-') && name.endsWith('.sahukar-backup'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  for (const backup of backups.slice(5)) fs.rmSync(path.join(directory, backup.name), { force: true });
}

async function exportBackup(userId) {
  const normalizedUserId = validateUserId(userId);
  const backup = createBackupDocument(normalizedUserId);
  const result = await dialog.showSaveDialog({
    title: 'Export Sahukar Ledger backup',
    defaultPath: `sahukar-backup-${new Date().toISOString().slice(0, 10)}.sahukar-backup`,
    filters: [{ name: 'Sahukar Ledger Backup', extensions: ['sahukar-backup'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  writeBackupFile(result.filePath, backup);
  return { canceled: false };
}

async function restoreBackup(userId) {
  const normalizedUserId = validateUserId(userId);
  const result = await dialog.showOpenDialog({
    title: 'Restore Sahukar Ledger backup',
    properties: ['openFile'],
    filters: [{ name: 'Sahukar Ledger Backup', extensions: ['sahukar-backup'] }]
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const sourcePath = result.filePaths[0];
  const stat = fs.statSync(sourcePath);
  if (stat.size > 400 * 1024 * 1024) throw new Error('Backup exceeds the supported size limit.');
  const backup = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  validateBackupDocument(normalizedUserId, backup);

  const userDirectory = getUserDirectory(normalizedUserId);
  const backupsDirectory = path.join(userDirectory, 'backups');
  fs.mkdirSync(backupsDirectory, { recursive: true, mode: 0o700 });
  const safetyPath = path.join(backupsDirectory, `safety-${Date.now()}.sahukar-backup`);
  writeBackupFile(safetyPath, createBackupDocument(normalizedUserId));
  pruneSafetyBackups(normalizedUserId);

  const customerRoot = path.join(userDirectory, 'customers');
  const stagingRoot = path.join(userDirectory, `customers-restore-${Date.now()}`);
  const previousRoot = path.join(userDirectory, `customers-previous-${Date.now()}`);
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  try {
    for (const customer of backup.ledger.customers) {
      const id = validateId(customer.id, 'customer ID');
      for (const kind of ['photos', 'documents', 'receipts']) fs.mkdirSync(path.join(stagingRoot, id, kind), { recursive: true, mode: 0o700 });
    }
    for (const file of backup.files) {
      const destination = path.join(stagingRoot, validateId(file.customerId, 'customer ID'), ...file.relativePath.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 });
    }

    if (fs.existsSync(customerRoot)) fs.renameSync(customerRoot, previousRoot);
    fs.renameSync(stagingRoot, customerRoot);
    try {
      saveLedger(normalizedUserId, backup.ledger);
    } catch (error) {
      fs.rmSync(customerRoot, { recursive: true, force: true });
      if (fs.existsSync(previousRoot)) fs.renameSync(previousRoot, customerRoot);
      throw error;
    }
    fs.rmSync(previousRoot, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (!fs.existsSync(customerRoot) && fs.existsSync(previousRoot)) fs.renameSync(previousRoot, customerRoot);
    throw error;
  }
  return { canceled: false, ledger: readLedger(normalizedUserId) };
}

function assertTrustedSender(event) {
  const senderUrl = new URL(event.senderFrame.url);
  if (senderUrl.protocol !== 'file:' && !(senderUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(senderUrl.hostname))) {
    throw new Error('Untrusted renderer origin.');
  }
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return callback(...args);
  });
}

function registerStorageIpc() {
  handle('ledger:initialize', (userId) => {
    getDatabase(userId);
    return true;
  });
  handle('ledger:close', (userId) => {
    const normalizedUserId = validateUserId(userId);
    const database = userDatabases.get(normalizedUserId);
    if (database) {
      database.close();
      userDatabases.delete(normalizedUserId);
    }
    return true;
  });
  handle('ledger:read', readLedger);
  handle('ledger:write', saveLedger);
  handle('ledger:backup-export', exportBackup);
  handle('ledger:backup-restore', restoreBackup);
  handle('ledger:delete-customer-files', (userId, customerId) => {
    const normalizedUserId = validateUserId(userId);
    const id = validateId(customerId, 'customer ID');
    const database = getDatabase(normalizedUserId);
    if (!database.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) throw new Error('Customer not found in this user ledger.');
    fs.rmSync(path.join(getUserDirectory(normalizedUserId), 'customers', id), { recursive: true, force: true });
    return true;
  });
  handle('ledger:secret-store', (userId, key, value) => {
    validateUserId(userId);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS-protected secret storage is unavailable.');
    if (!new RegExp(`^ledger_pin(?:_attempts)?:${userId}$`, 'i').test(key) || typeof value !== 'string' || value.length > 512) throw new TypeError('Invalid secret request.');
    const secretPath = path.join(app.getPath('userData'), 'encrypted-secrets.json');
    let secrets = {};
    if (fs.existsSync(secretPath)) secrets = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
    secrets[key] = safeStorage.encryptString(value).toString('base64');
    fs.writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    return true;
  });
  handle('ledger:secret-get', (userId, key) => {
    validateUserId(userId);
    if (!safeStorage.isEncryptionAvailable() || !new RegExp(`^ledger_pin(?:_attempts)?:${userId}$`, 'i').test(key)) return null;
    const secretPath = path.join(app.getPath('userData'), 'encrypted-secrets.json');
    if (!fs.existsSync(secretPath)) return null;
    const secrets = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
    return secrets[key] ? safeStorage.decryptString(Buffer.from(secrets[key], 'base64')) : null;
  });
  handle('ledger:secret-remove', (userId, key) => {
    validateUserId(userId);
    if (!new RegExp(`^ledger_pin(?:_attempts)?:${userId}$`, 'i').test(key)) throw new TypeError('Invalid secret request.');
    const secretPath = path.join(app.getPath('userData'), 'encrypted-secrets.json');
    if (!fs.existsSync(secretPath)) return true;
    const secrets = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
    delete secrets[key];
    fs.writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    return true;
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  registerStorageIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const database of userDatabases.values()) database.close();
  userDatabases.clear();
});