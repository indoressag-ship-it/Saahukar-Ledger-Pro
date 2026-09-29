const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function validateUserId(userId) {
  if (typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) throw new TypeError('A valid authenticated user ID is required.');
  return userId.toLowerCase();
}

function validateId(id, label) {
  const normalized = String(id ?? '');
  if (!SAFE_ID_PATTERN.test(normalized)) throw new TypeError(`Invalid ${label}.`);
  return normalized;
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

const getDbName = (userId) => `ledger_${validateUserId(userId).replaceAll('-', '')}`;
const getCustomerPath = (userId, customerId) => `users/${validateUserId(userId)}/customers/${validateId(customerId, 'customer ID')}`;

async function getSqlite() {
  if (typeof window === 'undefined' || !window.Capacitor?.isNativePlatform?.()) {
    throw new Error('Native SQLite is only available in the Capacitor app.');
  }
  const module = await import('@capacitor-community/sqlite');
  const filesystem = await import('@capacitor/filesystem');
  return { ...module, filesystem };
}

async function ensureCustomerFolders(userId, customerId) {
  const { filesystem } = await getSqlite();
  const root = getCustomerPath(userId, customerId);
  for (const kind of ['photos', 'documents', 'receipts']) {
    await filesystem.Filesystem.mkdir({ path: `${root}/${kind}`, directory: filesystem.Directory.Data, recursive: true });
  }
}

async function withDb(userId, callback) {
  const normalizedUserId = validateUserId(userId);
  const { SQLiteConnection, CapacitorSQLite } = await getSqlite();
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const connection = await sqlite.createConnection(getDbName(normalizedUserId), false, 'no-encryption', 1);
  await connection.open();
  try {
    await connection.execute('PRAGMA foreign_keys = ON;');
    const tables = await connection.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customers'");
    const customerColumns = tables.values?.length ? await connection.query('PRAGMA table_info(customers)') : { values: [] };
    const isLegacy = (customerColumns.values || []).some((column) => column.name === 'principal');
    if (isLegacy) {
      await connection.execute('ALTER TABLE customers RENAME TO customers_legacy_v1;');
      const paymentTable = await connection.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payments'");
      if (paymentTable.values?.length) await connection.execute('ALTER TABLE payments RENAME TO payments_legacy_v1;');
    }

    await connection.execute(`
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
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS payments_customer_date_idx ON payments(customer_id, payment_date DESC);
      CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name COLLATE NOCASE);
    `);
    await connection.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['schema_version', '2']);

    if (isLegacy) {
      const legacyCustomers = await connection.query('SELECT * FROM customers_legacy_v1 WHERE user_id = ?', [normalizedUserId]);
      const legacyPayments = await connection.query('SELECT * FROM payments_legacy_v1 WHERE user_id = ?', [normalizedUserId]);
      await connection.beginTransaction();
      try {
        for (const customer of legacyCustomers.values || []) {
          const id = validateId(customer.id, 'customer ID');
          const createdAt = customer.created_at || new Date().toISOString();
          await connection.run('INSERT INTO customers (id, name, mobile, address, gov_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, customer.name || '', customer.mobile || '', customer.address || '', customer.gov_id || '', createdAt, customer.updated_at || createdAt]);
          await connection.run('INSERT INTO loans (id, customer_id, principal_paise, interest_rate, loan_date, collateral, gold_weight, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, id, moneyToPaise(customer.principal), Number(customer.interest_rate || 0), customer.loan_date || '', customer.collateral || '', Number(customer.gold_weight || 0), customer.notes || '', customer.updated_at || createdAt]);
          await ensureCustomerFolders(normalizedUserId, id);
        }
        for (const payment of legacyPayments.values || []) {
          const id = validateId(payment.id, 'payment ID');
          const customerId = validateId(payment.customer_id, 'payment customer ID');
          await connection.run('INSERT INTO payments (id, customer_id, payment_date, total_paid_paise, interest_paid_paise, principal_paid_paise, remaining_principal_paise, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, customerId, payment.payment_date || '', moneyToPaise(payment.total_paid), moneyToPaise(payment.interest_paid), moneyToPaise(payment.principal_paid), moneyToPaise(payment.remaining_principal), payment.created_at || new Date().toISOString()]);
        }
        await connection.commitTransaction();
      } catch (error) {
        await connection.rollbackTransaction();
        throw error;
      }
      await connection.execute('DROP TABLE customers_legacy_v1;');
      await connection.execute('DROP TABLE IF EXISTS payments_legacy_v1;');
    }

    return await callback(connection);
  } finally {
    await connection.close();
  }
}

export async function ensureUserStorage(userId) {
  await withDb(userId, async () => true);
  return true;
}

export async function readLedger(userId) {
  return withDb(userId, async (connection) => {
    const customerRows = await connection.query(`
      SELECT customers.*, loans.principal_paise, loans.interest_rate, loans.loan_date,
        loans.collateral, loans.gold_weight, loans.notes AS loan_notes
      FROM customers LEFT JOIN loans ON loans.customer_id = customers.id
      ORDER BY customers.created_at DESC
    `);
    const paymentRows = await connection.query('SELECT * FROM payments ORDER BY created_at DESC');
    const customers = (customerRows.values || []).map((row) => ({
      ...JSON.parse(row.extra_json || '{}'),
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
    }));
    const payments = (paymentRows.values || []).map((row) => ({
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
  });
}

export async function writeLedger(userId, ledger) {
  const normalizedUserId = validateUserId(userId);
  const customers = Array.isArray(ledger?.customers) ? ledger.customers : [];
  const payments = Array.isArray(ledger?.payments) ? ledger.payments : [];
  const customerIds = new Set(customers.map((customer) => validateId(customer.id, 'customer ID')));
  const nextValue = { customers, payments };

  await withDb(normalizedUserId, async (connection) => {
    const now = new Date().toISOString();
    await connection.beginTransaction();
    try {
      for (const customer of customers) {
        const id = validateId(customer.id, 'customer ID');
        const { principal, interest_rate, loan_date, collateral, gold_weight, notes, ...extra } = customer;
        const existing = await connection.query('SELECT created_at FROM customers WHERE id = ?', [id]);
        const createdAt = customer.created_at || existing.values?.[0]?.created_at || now;
        await connection.run(`INSERT INTO customers (id, name, mobile, address, gov_id, created_at, updated_at, extra_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
          mobile=excluded.mobile, address=excluded.address, gov_id=excluded.gov_id,
          updated_at=excluded.updated_at, extra_json=excluded.extra_json`, [id, String(customer.name || ''), String(customer.mobile || ''), String(customer.address || ''), String(customer.gov_id || ''), createdAt, now, JSON.stringify(extra)]);
        await connection.run(`INSERT INTO loans (id, customer_id, principal_paise, interest_rate, loan_date, collateral, gold_weight, notes, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(customer_id) DO UPDATE SET
          principal_paise=excluded.principal_paise, interest_rate=excluded.interest_rate,
          loan_date=excluded.loan_date, collateral=excluded.collateral, gold_weight=excluded.gold_weight,
          notes=excluded.notes, updated_at=excluded.updated_at`, [id, id, moneyToPaise(principal), Number(interest_rate || 0), String(loan_date || ''), String(collateral || ''), Number(gold_weight || 0), String(notes || ''), now]);
        await ensureCustomerFolders(normalizedUserId, id);
      }

      const oldCustomers = await connection.query('SELECT id FROM customers');
      for (const row of oldCustomers.values || []) {
        if (!customerIds.has(row.id)) await connection.run('DELETE FROM customers WHERE id = ?', [row.id]);
      }

      const paymentIds = new Set();
      for (const payment of payments) {
        const id = validateId(payment.id, 'payment ID');
        const customerId = validateId(payment.customer_id, 'payment customer ID');
        if (!customerIds.has(customerId)) throw new Error('Payment refers to a customer outside this ledger.');
        paymentIds.add(id);
        const { total_paid, interest_paid, principal_paid, remaining_principal, ...extra } = payment;
        const existing = await connection.query('SELECT created_at FROM payments WHERE id = ?', [id]);
        await connection.run(`INSERT INTO payments (id, customer_id, payment_date, total_paid_paise,
          interest_paid_paise, principal_paid_paise, remaining_principal_paise, created_at, extra_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
          customer_id=excluded.customer_id, payment_date=excluded.payment_date,
          total_paid_paise=excluded.total_paid_paise, interest_paid_paise=excluded.interest_paid_paise,
          principal_paid_paise=excluded.principal_paid_paise,
          remaining_principal_paise=excluded.remaining_principal_paise, extra_json=excluded.extra_json`, [id, customerId, String(payment.payment_date || ''), moneyToPaise(total_paid), moneyToPaise(interest_paid), moneyToPaise(principal_paid), moneyToPaise(remaining_principal), payment.created_at || existing.values?.[0]?.created_at || now, JSON.stringify(extra)]);
      }
      const oldPayments = await connection.query('SELECT id FROM payments');
      for (const row of oldPayments.values || []) {
        if (!paymentIds.has(row.id)) await connection.run('DELETE FROM payments WHERE id = ?', [row.id]);
      }
      await connection.commitTransaction();
    } catch (error) {
      await connection.rollbackTransaction();
      throw error;
    }
  });

  return readLedger(normalizedUserId);
}

export async function deleteCustomerFiles(userId, customerId) {
  const normalizedUserId = validateUserId(userId);
  const id = validateId(customerId, 'customer ID');
  await withDb(normalizedUserId, async (connection) => {
    const customer = await connection.query('SELECT 1 FROM customers WHERE id = ?', [id]);
    if (!customer.values?.length) throw new Error('Customer not found in this user ledger.');
  });
  const { filesystem } = await getSqlite();
  try {
    await filesystem.Filesystem.rmdir({ path: getCustomerPath(normalizedUserId, id), directory: filesystem.Directory.Data, recursive: true });
  } catch (error) {
    if (!String(error?.message || '').toLowerCase().includes('does not exist')) throw error;
  }
  return true;
}

export async function exportBackup(userId) {
  return {
    format: 'sahukar-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    userId: validateUserId(userId),
    ledger: await readLedger(userId)
  };
}

