import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import barcodeRoutes from './routes/barcode.js';
import categoriesConfig from './routes/configs/categories.js';
import brandsConfig from './routes/configs/brands.js';
import unitsConfig from './routes/configs/units.js';
import customersConfig from './routes/configs/customers.js';
import suppliersConfig from './routes/configs/suppliers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeDir = path.join(__dirname, '..', 'runtime');
const jwtSecretPath = path.join(runtimeDir, 'jwt-secret.txt');

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  fs.mkdirSync(runtimeDir, { recursive: true });

  if (fs.existsSync(jwtSecretPath)) {
    return fs.readFileSync(jwtSecretPath, 'utf8').trim();
  }

  const secret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(jwtSecretPath, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
};

const JWT_SECRET = getJwtSecret();
const SALT_ROUNDS = 10;
const ALLOWED_SALE_ROLES = ['Admin', 'Cashier'];
const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3000;

const app = express();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const isLocalOrigin = (origin) => {
  if (!origin || origin === 'null') {
    return true;
  }

  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
};

const simpleTables = {
  categories: categoriesConfig,
  brands: brandsConfig,
  units: unitsConfig,
  customers: customersConfig,
  suppliers: suppliersConfig,
  roles: {
    table: 'roles',
    columns: ['name'],
    required: ['name'],
    label: 'role',
  },
  payment_methods: {
    table: 'payment_methods',
    columns: ['name'],
    required: ['name'],
    label: 'payment method',
  },
  settings: {
    table: 'settings',
    columns: ['key', 'value'],
    required: ['key', 'value'],
    label: 'setting',
  },
  users: {
    table: 'users',
    columns: ['full_name', 'username', 'email', 'password', 'role_id', 'status', 'store_id'],
    required: ['full_name', 'email', 'password'],
    label: 'user',
    select: 'id, full_name, username, email, role_id, status, store_id, created_at',
  },
  inventory_movements: {
    table: 'inventory_movements',
    columns: ['product_id', 'movement_type', 'quantity', 'note'],
    required: ['product_id', 'movement_type', 'quantity'],
    label: 'inventory movement',
  },
};

const productColumns = ['name', 'item_code', 'sku', 'barcode', 'price', 'cost', 'quantity', 'category_id', 'brand_id', 'unit_id'];

const PRODUCT_ROUTES = ['/products', '/api/products'];
const PRODUCT_SEARCH_ROUTES = ['/products/search', '/api/products/search'];
const PRODUCT_DETAIL_ROUTES = ['/products/:id', '/api/products/:id'];
const SALES_ROUTES = ['/sales', '/api/sales'];
const SALES_DETAIL_ROUTES = ['/sales/:id', '/api/sales/:id'];
const STATS_ROUTES = ['/stats', '/api/stats'];
const REPORT_SALES_ROUTES = ['/reports/sales', '/api/reports/sales'];
const REPORT_PRODUCTS_ROUTES = ['/reports/products', '/api/reports/products'];
const REPORT_CATEGORIES_ROUTES = ['/reports/categories', '/api/reports/categories'];
const REPORT_STORES_ROUTES = ['/reports/stores', '/api/reports/stores'];
const AUTH_ME_ROUTES = ['/me', '/api/me', '/auth/me', '/api/auth/me'];
const AUTH_LOGOUT_ROUTES = ['/logout', '/api/logout', '/auth/logout', '/api/auth/logout'];
const STORE_ROUTES = ['/stores', '/api/stores'];
const STORE_DETAIL_ROUTES = ['/stores/:id', '/api/stores/:id'];
const STORE_USERS_ROUTES = ['/stores/:id/users', '/api/stores/:id/users'];
const STORE_USER_DETAIL_ROUTES = ['/stores/:id/users/:userId', '/api/stores/:id/users/:userId'];
const STORE_INVENTORY_ROUTES = ['/stores/:id/inventory', '/api/stores/:id/inventory'];
const STORE_INVENTORY_DETAIL_ROUTES = ['/stores/:id/inventory/:productId', '/api/stores/:id/inventory/:productId'];
const STORE_CODE_ROUTES = ['/stores/:id/generate-code', '/api/stores/:id/generate-code'];
const STORE_ACCESS_CODES_ROUTES = ['/stores/:id/access-codes', '/api/stores/:id/access-codes'];
const STORE_ACCESS_CODE_ACTION_ROUTES = [
  '/stores/:id/access-codes/generate',
  '/api/stores/:id/access-codes/generate',
  '/stores/:id/access-codes/regenerate',
  '/api/stores/:id/access-codes/regenerate',
];
const ACCESS_CODE_VERIFY_ROUTES = ['/access-codes/verify', '/api/access-codes/verify'];
const LOGIN_ROUTES = ['/login', '/api/login'];
const PASSWORD_RESET_REQUEST_ROUTES = ['/password-reset/request', '/api/password-reset/request'];
const PASSWORD_RESET_ROUTES = ['/password-reset/reset', '/api/password-reset/reset'];
const CHANGE_PASSWORD_ROUTES = ['/change-password', '/api/change-password'];

const apiPath = (path) => (path.startsWith('/api') ? path : `/api${path}`);

const routeVariants = (path) => {
  const camel = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/_/g, ''))
    .join('/');

  const snake = path.replace(/-/g, '_');

  return Array.from(new Set([path, apiPath(path), `/${camel}`, apiPath(`/${camel}`), snake, apiPath(snake)]));
};

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });

const withTransaction = async (callback) => {
  await dbRun('BEGIN IMMEDIATE TRANSACTION');

  try {
    const result = await callback();
    await dbRun('COMMIT');
    return result;
  } catch (error) {
    await dbRun('ROLLBACK').catch(() => {});
    throw error;
  }
};

const sendDbError = (res, error) => res.status(500).json({ error: error.message });

const pickFields = (body, columns) =>
  columns.reduce((payload, column) => {
    if (body[column] !== undefined) {
      payload[column] = body[column];
    }

    return payload;
  }, {});

const validateRequired = (body, required) => required.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');

const buildInsert = (table, columns, body) => {
  const values = pickFields(body, columns);
  const keys = Object.keys(values);

  return {
    sql: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    params: keys.map((key) => values[key]),
  };
};

const buildUpdate = (table, columns, existing, body) => {
  const values = {};

  for (const column of columns) {
    values[column] = body[column] !== undefined ? body[column] : existing[column];
  }

  const keys = Object.keys(values);

  return {
    sql: `UPDATE ${table} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`,
    params: [...keys.map((key) => values[key]), existing.id],
  };
};

const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);

const cleanupRevokedTokens = async () => {
  await dbRun('DELETE FROM revoked_tokens WHERE expires_at <= ?', [Date.now()]);
};

const isTokenRevoked = async (token) => {
  const row = await dbGet('SELECT token FROM revoked_tokens WHERE token = ?', [token]);
  return Boolean(row);
};

const revokeToken = async (token, expiresAt) => {
  await dbRun('INSERT OR REPLACE INTO revoked_tokens (token, expires_at) VALUES (?, ?)', [token, expiresAt]);
  await cleanupRevokedTokens().catch(() => {});
};

const maybeHashUserPassword = async (table, body) => {
  if (table !== 'users' || !body.password) {
    return body;
  }

  return { ...body, password: await hashPassword(body.password) };
};

const signAuthToken = (user) =>
  jwt.sign({ id: user.id, role_id: user.role_id, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '8h' });

const buildAuthPayload = async (user) => {
  const role = await dbGet('SELECT name FROM roles WHERE id = ?', [user.role_id]);

  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username ?? null,
    email: user.email,
    role_id: user.role_id,
    role_name: role?.name ?? 'User',
    status: user.status ?? 'Active',
    store_id: user.store_id ?? null,
    token: signAuthToken(user),
  };
};

const userHasAllowedRole = async (roleId, allowedRoles) => {
  const role = await dbGet('SELECT name FROM roles WHERE id = ?', [roleId]);
  return Boolean(role && allowedRoles.includes(role.name));
};

const requireRoleNames = (allowedRoles) => async (req, res, next) => {
  try {
    const allowed = await userHasAllowedRole(req.user.role_id, allowedRoles);
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  } catch (error) {
    sendDbError(res, error);
  }
};

const routeFor = (name) => `/${name.replaceAll('_', '-')}`;

const registerSimpleCrud = (name, config) => {
  const route = routeFor(name);
  const variants = routeVariants(route);
  const listHandler = (_req, res) => {
    dbAll(`SELECT ${config.select ?? '*'} FROM ${config.table} ORDER BY id DESC`)
      .then((rows) => res.json(rows))
      .catch((error) => sendDbError(res, error));
  };

  const detailHandler = (req, res) => {
    dbGet(`SELECT ${config.select ?? '*'} FROM ${config.table} WHERE id = ?`, [req.params.id])
      .then((row) => {
        if (!row) {
          res.status(404).json({ error: `${config.label} not found` });
          return;
        }

        res.json(row);
      })
      .catch((error) => sendDbError(res, error));
  };

  const createHandler = async (req, res) => {
    const missing = validateRequired(req.body, config.required);
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    try {
      const payload = await maybeHashUserPassword(config.table, req.body);
      const { sql, params } = buildInsert(config.table, config.columns, payload);
      const result = await dbRun(sql, params);
      const row = await dbGet(`SELECT ${config.select ?? '*'} FROM ${config.table} WHERE id = ?`, [result.lastID]);
      res.status(201).json(row);
    } catch (error) {
      sendDbError(res, error);
    }
  };

  const updateHandler = async (req, res) => {
    try {
      const existing = await dbGet(`SELECT * FROM ${config.table} WHERE id = ?`, [req.params.id]);
      if (!existing) {
        res.status(404).json({ error: `${config.label} not found` });
        return;
      }

      const payload = await maybeHashUserPassword(config.table, req.body);
      const { sql, params } = buildUpdate(config.table, config.columns, existing, payload);
      await dbRun(sql, params);
      const updated = await dbGet(`SELECT ${config.select ?? '*'} FROM ${config.table} WHERE id = ?`, [req.params.id]);
      res.json(updated);
    } catch (error) {
      sendDbError(res, error);
    }
  };

  const deleteHandler = (req, res) => {
    dbRun(`DELETE FROM ${config.table} WHERE id = ?`, [req.params.id])
      .then((result) => {
        if (result.changes === 0) {
          res.status(404).json({ error: `${config.label} not found` });
          return;
        }

        res.json({ message: `${config.label} deleted` });
      })
      .catch((error) => sendDbError(res, error));
  };

  for (const variant of variants) {
    app.get(variant, listHandler);
    app.get(`${variant}/:id`, detailHandler);
    app.post(variant, authenticate, createHandler);
    app.put(`${variant}/:id`, authenticate, updateHandler);
    app.delete(`${variant}/:id`, authenticate, deleteHandler);
  }
};

// JWT authentication middleware
async function authenticate(req, res, next) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header) return res.status(401).json({ error: 'Authorization header missing' });

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Invalid authorization header' });

  const token = parts[1];
  try {
    if (await isTokenRevoked(token)) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const buildProductSearchClause = (search) => {
  if (!search) {
    return { where: '', params: [] };
  }

  const term = `%${String(search).toLowerCase()}%`;
  return {
    where: `
      WHERE (
        LOWER(COALESCE(p.name, '')) LIKE ?
        OR LOWER(COALESCE(p.sku, '')) LIKE ?
        OR LOWER(COALESCE(p.barcode, '')) LIKE ?
        OR LOWER(COALESCE(p.item_code, '')) LIKE ?
      )
    `,
    params: [term, term, term, term],
  };
};

const buildProductSearchOrderClause = (search) => {
  const term = String(search ?? '').trim().toLowerCase();

  if (!term) {
    return { orderBy: 'ORDER BY p.id DESC', params: [] };
  }

  const prefix = `${term}%`;

  return {
    orderBy: `
      ORDER BY
        CASE
          WHEN LOWER(COALESCE(p.item_code, '')) = ? THEN 0
          WHEN LOWER(COALESCE(p.name, '')) = ? THEN 1
          WHEN LOWER(COALESCE(p.item_code, '')) LIKE ? THEN 2
          WHEN LOWER(COALESCE(p.name, '')) LIKE ? THEN 3
          ELSE 4
        END,
        p.id DESC
    `,
    params: [term, term, prefix, prefix],
  };
};

const getProductList = (limit = 10, offset = 0, search = '') => {
  const searchClause = buildProductSearchClause(search);
  const orderClause = buildProductSearchOrderClause(search);

  return dbAll(`
    SELECT
      p.id,
      p.name,
      p.sku,
      p.item_code,
      p.barcode,
      p.price,
      p.cost,
      p.category_id,
      p.brand_id,
      p.unit_id,
      c.name AS category_name,
      b.name AS brand_name,
      u.name AS unit_name,
      u.short_name AS unit_short_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN units u ON u.id = p.unit_id
    ${searchClause.where}
    ${orderClause.orderBy}
    LIMIT ? OFFSET ?
  `, [...searchClause.params, ...orderClause.params, limit, offset]);
};

const productDetailSelectSql = `
  SELECT
    p.id,
    p.name,
    p.sku,
    p.item_code,
    p.barcode,
    p.price,
    p.cost,
    p.category_id,
    p.brand_id,
    p.unit_id,
    c.name AS category_name,
    b.name AS brand_name,
    u.name AS unit_name,
    u.short_name AS unit_short_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN units u ON u.id = p.unit_id
`;

const getProductById = (id) =>
  dbGet(
    `${productDetailSelectSql} WHERE p.id = ?`,
    [id]
  );

const getProductByLookup = (lookup) =>
  dbGet(
    `${productDetailSelectSql} WHERE p.item_code = ? OR p.barcode = ? OR p.sku = ?`,
    [lookup, lookup, lookup]
  );

const getBootstrapData = async () => ({
  stores: await dbAll('SELECT id, name, city, status, store_code, created_at FROM stores ORDER BY id DESC'),
  categories: await dbAll('SELECT * FROM categories ORDER BY name'),
  brands: await dbAll('SELECT * FROM brands ORDER BY name'),
  units: await dbAll('SELECT * FROM units ORDER BY name'),
  customers: await dbAll('SELECT * FROM customers ORDER BY name'),
  suppliers: await dbAll('SELECT * FROM suppliers ORDER BY name'),
  roles: await dbAll('SELECT * FROM roles ORDER BY name'),
  payment_methods: await dbAll('SELECT * FROM payment_methods ORDER BY name'),
  settings: await dbAll('SELECT * FROM settings ORDER BY key'),
  products: await getProductList(10, 0), // Limit to first 10 for health check
  users: await dbAll('SELECT id, full_name, username, email, role_id, status, store_id, created_at FROM users ORDER BY id DESC'),
});

// Returns products whose category is missing or not resolvable
const getMismatchedCategories = async (limit = 100, offset = 0) => {
  const countRow = await dbGet(
    `SELECT COUNT(*) AS count FROM products p WHERE p.category_id IS NULL OR NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = p.category_id)`
  );

  const rows = await dbAll(
    `
      SELECT
        p.id,
        p.name,
        p.item_code,
        p.barcode,
        p.price,
        p.cost,
        p.store_id,
        p.created_at
      FROM products p
      WHERE p.category_id IS NULL OR NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = p.category_id)
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
    `,
    [limit, offset]
  );

  return { count: countRow?.count ?? 0, products: rows };
};

const generateInvoiceNo = async () => {
  const row = await dbGet('SELECT COUNT(*) AS count FROM sales');
  const nextNumber = (row?.count ?? 0) + 1;
  return `INV-${String(nextNumber).padStart(5, '0')}`;
};

const buildDateRangeClause = (query, column = 's.created_at') => {
  const clauses = [];
  const params = [];

  if (query.from) {
    clauses.push(`DATE(${column}) >= DATE(?)`);
    params.push(query.from);
  }

  if (query.to) {
    clauses.push(`DATE(${column}) <= DATE(?)`);
    params.push(query.to);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

const getSalesReportRows = async (query) => {
  const { where, params } = buildDateRangeClause(query, 's.created_at');

  const rows = await dbAll(
    `
      SELECT
        s.id,
        s.invoice_no,
        s.created_at,
        s.subtotal,
        s.discount,
        s.tax,
        s.total,
        s.amount_paid,
        s.change_amount,
        st.name AS store_name,
        c.name AS customer_name,
        u.full_name AS user_name,
        p.name AS payment_method_name
      FROM sales s
      LEFT JOIN stores st ON st.id = s.store_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN payment_methods p ON p.id = s.payment_method_id
      ${where}
      ORDER BY s.created_at DESC, s.id DESC
    `,
    params
  );

  const summary = await dbGet(
    `
      SELECT
        COUNT(*) AS total_sales,
        COALESCE(SUM(total), 0) AS total_revenue,
        COALESCE(SUM(subtotal), 0) AS subtotal,
        COALESCE(SUM(discount), 0) AS total_discount,
        COALESCE(SUM(tax), 0) AS total_tax
      FROM sales s
      ${where}
    `,
    params
  );

  return { summary, rows };
};

const getAggregatedReportRows = async (query, dimensionSql, selectSql) => {
  const { where, params } = buildDateRangeClause(query, 's.created_at');

  return dbAll(
    `
      SELECT
        ${dimensionSql},
        ${selectSql}
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      INNER JOIN products pr ON pr.id = si.product_id
      LEFT JOIN categories c ON c.id = pr.category_id
      LEFT JOIN stores st ON st.id = s.store_id
      ${where}
      GROUP BY ${dimensionSql}
      ORDER BY revenue DESC, total_sold DESC
    `,
    params
  );
};

const getStatsData = async () => {
  const [stores, users, products, sales, revenue, activeStores, inactiveStores] = await Promise.all([
    dbGet('SELECT COUNT(*) AS count FROM stores'),
    dbGet('SELECT COUNT(*) AS count FROM users'),
    dbGet('SELECT COUNT(*) AS count FROM products'),
    dbGet('SELECT COUNT(*) AS count FROM sales'),
    dbGet('SELECT COALESCE(SUM(total), 0) AS total FROM sales'),
    dbGet("SELECT COUNT(*) AS count FROM stores WHERE status = 'Active'"),
    dbGet("SELECT COUNT(*) AS count FROM stores WHERE status != 'Active'"),
  ]);

  const topProducts = await dbAll(
    `
      SELECT
        pr.id,
        pr.name,
        COALESCE(SUM(si.quantity), 0) AS total_sold,
        COALESCE(SUM(si.total), 0) AS revenue
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      INNER JOIN products pr ON pr.id = si.product_id
      GROUP BY pr.id, pr.name
      ORDER BY revenue DESC
      LIMIT 5
    `
  );

  return {
    total_stores: stores?.count ?? 0,
    total_users: users?.count ?? 0,
    total_products: products?.count ?? 0,
    total_sales: sales?.count ?? 0,
    total_revenue: revenue?.total ?? 0,
    active_stores: activeStores?.count ?? 0,
    inactive_stores: inactiveStores?.count ?? 0,
    top_products: topProducts,
  };
};

const getStoreUsers = (storeId) =>
  dbAll(
    `
      SELECT
        u.id,
        u.full_name AS name,
        u.username,
        u.email,
        COALESCE(r.name, 'User') AS role,
        COALESCE(u.status, 'Active') AS status,
        u.created_at AS joined
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.store_id = ?
      ORDER BY u.id ASC
    `,
    [storeId]
  );

const getStoreAccessCodes = (storeId) =>
  dbAll(
    `
      SELECT
        ac.id,
        ac.store_id,
        ac.code,
        ac.status,
        ac.created_at,
        ac.used_at,
        ac.created_by,
        creator.full_name AS created_by_name,
        ac.used_by,
        used_user.full_name AS used_by_name
      FROM access_codes ac
      LEFT JOIN users creator ON creator.id = ac.created_by
      LEFT JOIN users used_user ON used_user.id = ac.used_by
      WHERE ac.store_id = ?
      ORDER BY ac.id DESC
    `,
    [storeId]
  );

const getLoginUserForStore = async (storeId) =>
  dbGet(
    `
      SELECT
        id,
        full_name,
        username,
        email,
        password,
        role_id,
        status,
        store_id
      FROM users
      WHERE store_id = ? AND COALESCE(status, 'Active') != 'Inactive'
      ORDER BY id ASC
      LIMIT 1
    `,
    [storeId]
  );

const getStoreInventory = (storeId) =>
  dbAll(
    `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        c.name AS category,
        b.name AS brand,
        u.name AS unit,
        p.quantity AS stock,
        p.price,
        p.cost,
        p.created_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.store_id = ?
      ORDER BY p.name ASC
    `,
    [storeId]
  );

const generateStoreCode = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(crypto.randomInt(1000, 10000));
    const existing = await dbGet('SELECT id FROM stores WHERE store_code = ?', [code]);
    if (!existing) {
      return code;
    }
  }

  return `${Date.now()}`;
};

const getStoreDetail = async (storeId) => {
  const store = await dbGet(
    `
      SELECT
        s.id,
        s.name,
        s.address,
        s.city,
        s.phone,
        s.email,
        s.status,
        s.store_code AS code,
        s.store_code,
        s.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id) AS users_count,
        (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS products_count,
        (SELECT COUNT(*) FROM sales sa WHERE sa.store_id = s.id) AS sales_count
      FROM stores s
      WHERE s.id = ?
    `,
    [storeId]
  );

  if (!store) {
    return null;
  }

  const [users, inventory, accessCodes] = await Promise.all([
    getStoreUsers(storeId),
    getStoreInventory(storeId),
    getStoreAccessCodes(storeId),
  ]);
  return { ...store, users, inventory, access_codes: accessCodes, access_codes_count: accessCodes.length };
};

const generateAccessCodeValue = async (storeId) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const existing = await dbGet('SELECT id FROM access_codes WHERE code = ?', [code]);
    if (!existing) {
      return code;
    }
  }

  throw new Error('Unable to generate a unique access code');
};

const createAccessCodeForStore = async (storeId, createdBy = null) =>
  withTransaction(async () => {
    const store = await dbGet('SELECT id FROM stores WHERE id = ?', [storeId]);
    if (!store) {
      const error = new Error('Store not found');
      error.status = 404;
      throw error;
    }

    const code = await generateAccessCodeValue(storeId);
    const result = await dbRun(
      'INSERT INTO access_codes (store_id, code, status, created_by) VALUES (?, ?, ?, ?)',
      [storeId, code, 'unused', createdBy]
    );

    return dbGet(
      `
        SELECT
          ac.id,
          ac.store_id,
          ac.code,
          ac.status,
          ac.created_at,
          ac.used_at,
          ac.created_by,
          ac.active_token,
          creator.full_name AS created_by_name,
          ac.used_by,
          used_user.full_name AS used_by_name
        FROM access_codes ac
        LEFT JOIN users creator ON creator.id = ac.created_by
        LEFT JOIN users used_user ON used_user.id = ac.used_by
        WHERE ac.id = ?
      `,
      [result.lastID]
    );
  });

const resolveAccessCodeForLogin = async ({ storeId = null, code }) => {
  const accessCode = await dbGet(
    `
      SELECT
        ac.id,
        ac.store_id,
        ac.code,
        ac.status,
        ac.created_at,
        ac.used_at,
        ac.created_by,
        ac.active_token,
        creator.full_name AS created_by_name,
        ac.used_by,
        used_user.full_name AS used_by_name
      FROM access_codes ac
      LEFT JOIN users creator ON creator.id = ac.created_by
      LEFT JOIN users used_user ON used_user.id = ac.used_by
      WHERE ac.code = ?
      ${storeId ? 'AND ac.store_id = ?' : ''}
      ORDER BY ac.id DESC
      LIMIT 1
    `,
    storeId ? [code, storeId] : [code]
  );

  if (!accessCode) {
    const error = new Error('Access code not found');
    error.status = 404;
    throw error;
  }

  return accessCode;
};

const getStoreList = (filters = {}) => {
  const where = [];
  const params = [];

  if (filters.status && filters.status !== 'All') {
    where.push('s.status = ?');
    params.push(filters.status);
  }

  if (filters.search) {
    where.push('(LOWER(s.name) LIKE ? OR LOWER(s.city) LIKE ? OR LOWER(s.address) LIKE ?)');
    const term = `%${String(filters.search).toLowerCase()}%`;
    params.push(term, term, term);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  return dbAll(
    `
      SELECT
        s.id,
        s.name,
        s.address,
        s.city,
        s.phone,
        s.email,
        s.status,
        s.store_code,
        s.store_code AS code,
        s.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id) AS users,
        (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS products,
        (SELECT COUNT(*) FROM sales sa WHERE sa.store_id = s.id) AS sales
      FROM stores s
      ${whereSql}
      ORDER BY s.id DESC
    `,
    params
  );
};

app.disable('x-powered-by');
app.use(
  cors({
    origin: (origin, callback) => {
      if (isLocalOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200,
  })
);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Barcode scanning routes
app.use('/api/products', barcodeRoutes);
app.use('/api/scan', barcodeRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/bootstrap', async (_req, res) => {
  try {
    res.json(await getBootstrapData());
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get('/api/bootstrap', async (_req, res) => {
  try {
    res.json(await getBootstrapData());
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(STORE_ROUTES, async (req, res) => {
  try {
    const stores = await getStoreList({ status: req.query.status, search: req.query.search });
    res.json(stores);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(STORE_DETAIL_ROUTES, async (req, res) => {
  try {
    const store = await getStoreDetail(req.params.id);
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    res.json(store);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.post(STORE_ROUTES, authenticate, async (req, res) => {
  try {
    const { name, address = null, city = null, phone = null, email = null, status = 'Active' } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const storeCode = req.body.store_code || req.body.code || (await generateStoreCode());
    const result = await dbRun(
      'INSERT INTO stores (name, address, city, phone, email, status, store_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, address, city, phone, email, status, storeCode]
    );

    const store = await getStoreDetail(result.lastID);
    res.status(201).json(store);
  } catch (error) {
    if (error.message?.includes('UNIQUE')) {
      res.status(400).json({ error: 'Store code already exists' });
      return;
    }

    sendDbError(res, error);
  }
});

app.put(STORE_DETAIL_ROUTES, authenticate, async (req, res) => {
  try {
    const existing = await dbGet('SELECT * FROM stores WHERE id = ?', [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const payload = {
      name: req.body.name ?? existing.name,
      address: req.body.address ?? existing.address,
      city: req.body.city ?? existing.city,
      phone: req.body.phone ?? existing.phone,
      email: req.body.email ?? existing.email,
      status: req.body.status ?? existing.status,
      store_code: req.body.store_code ?? req.body.code ?? existing.store_code,
    };

    await dbRun(
      'UPDATE stores SET name = ?, address = ?, city = ?, phone = ?, email = ?, status = ?, store_code = ? WHERE id = ?',
      [payload.name, payload.address, payload.city, payload.phone, payload.email, payload.status, payload.store_code, req.params.id]
    );

    const store = await getStoreDetail(req.params.id);
    res.json(store);
  } catch (error) {
    if (error.message?.includes('UNIQUE')) {
      res.status(400).json({ error: 'Store code already exists' });
      return;
    }

    sendDbError(res, error);
  }
});

app.delete(STORE_DETAIL_ROUTES, authenticate, async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM stores WHERE id = ?', [req.params.id]);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    res.json({ message: 'Store deleted' });
  } catch (error) {
    sendDbError(res, error);
  }
});

app.post(STORE_CODE_ROUTES, authenticate, async (req, res) => {
  try {
    const existing = await dbGet('SELECT * FROM stores WHERE id = ?', [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const storeCode = await generateStoreCode();
    await dbRun('UPDATE stores SET store_code = ? WHERE id = ?', [storeCode, req.params.id]);

    const store = await getStoreDetail(req.params.id);
    res.json(store);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(STORE_ACCESS_CODES_ROUTES, authenticate, async (req, res) => {
  try {
    const store = await dbGet('SELECT id FROM stores WHERE id = ?', [req.params.id]);
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    res.json(await getStoreAccessCodes(req.params.id));
  } catch (error) {
    sendDbError(res, error);
  }
});

const handleAccessCodeGenerate = async (req, res) => {
  try {
    const created = await createAccessCodeForStore(req.params.id, req.user?.id ?? null);
    res.status(201).json(created);
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    sendDbError(res, error);
  }
};

app.post(STORE_ACCESS_CODES_ROUTES, authenticate, handleAccessCodeGenerate);
app.post(STORE_ACCESS_CODE_ACTION_ROUTES, authenticate, handleAccessCodeGenerate);

app.post(ACCESS_CODE_VERIFY_ROUTES, async (req, res) => {
  try {
    const storeId = req.body.store_id ?? req.body.storeId ?? req.body.id;
    const code = String(req.body.code ?? '').trim();

    if (!code) {
      res.status(400).json({ error: 'code is required' });
      return;
    }

    const accessCode = await resolveAccessCodeForLogin({ storeId, code });
    const user = await getLoginUserForStore(accessCode.store_id);

    if (!user) {
      res.status(404).json({ error: 'No active user found for this store' });
      return;
    }

    const payload = await buildAuthPayload(user);

    res.json({
      message: 'Access code verified and user logged in',
      access_code: accessCode,
      ...payload,
    });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    sendDbError(res, error);
  }
});

app.get(STORE_USERS_ROUTES, async (req, res) => {
  try {
    const store = await dbGet('SELECT id FROM stores WHERE id = ?', [req.params.id]);
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    res.json(await getStoreUsers(req.params.id));
  } catch (error) {
    sendDbError(res, error);
  }
});

app.post(STORE_USERS_ROUTES, authenticate, async (req, res) => {
  try {
    const store = await dbGet('SELECT id FROM stores WHERE id = ?', [req.params.id]);
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const { full_name, username, email, password, role_id, status = 'Active' } = req.body;
    if (!full_name || !email || !password) {
      res.status(400).json({ error: 'full_name, email, and password are required' });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const result = await dbRun(
      'INSERT INTO users (full_name, username, email, password, role_id, status, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [full_name, username ?? null, email, hashedPassword, role_id ?? null, status, req.params.id]
    );

    const created = await dbGet('SELECT id, full_name, username, email, role_id, status, store_id, created_at FROM users WHERE id = ?', [result.lastID]);
    res.status(201).json(created);
  } catch (error) {
    if (error.message?.includes('UNIQUE')) {
      res.status(400).json({ error: 'User email or username already exists' });
      return;
    }

    sendDbError(res, error);
  }
});

app.put(STORE_USER_DETAIL_ROUTES, authenticate, async (req, res) => {
  try {
    const existing = await dbGet('SELECT * FROM users WHERE id = ? AND store_id = ?', [req.params.userId, req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'User not found for this store' });
      return;
    }

    const updates = {
      full_name: req.body.full_name ?? existing.full_name,
      username: req.body.username ?? existing.username,
      email: req.body.email ?? existing.email,
      role_id: req.body.role_id ?? existing.role_id,
      status: req.body.status ?? existing.status,
      store_id: req.params.id,
    };

    if (req.body.password) {
      updates.password = await hashPassword(req.body.password);
    }

    const columns = ['full_name', 'username', 'email', 'role_id', 'status', 'store_id'];
    const setClause = columns.map((column) => `${column} = ?`).join(', ');
    const params = columns.map((column) => updates[column]);

    if (updates.password) {
      params.push(updates.password);
    }

    const sql = updates.password
      ? `UPDATE users SET ${setClause}, password = ? WHERE id = ? AND store_id = ?`
      : `UPDATE users SET ${setClause} WHERE id = ? AND store_id = ?`;

    params.push(req.params.userId, req.params.id);

    await dbRun(sql, params);
    const updated = await dbGet('SELECT id, full_name, username, email, role_id, status, store_id, created_at FROM users WHERE id = ?', [req.params.userId]);
    res.json(updated);
  } catch (error) {
    if (error.message?.includes('UNIQUE')) {
      res.status(400).json({ error: 'User email or username already exists' });
      return;
    }

    sendDbError(res, error);
  }
});

app.delete(STORE_USER_DETAIL_ROUTES, authenticate, async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM users WHERE id = ? AND store_id = ?', [req.params.userId, req.params.id]);
    if (result.changes === 0) {
      res.status(404).json({ error: 'User not found for this store' });
      return;
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(STORE_INVENTORY_ROUTES, async (req, res) => {
  try {
    const store = await dbGet('SELECT id FROM stores WHERE id = ?', [req.params.id]);
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    res.json(await getStoreInventory(req.params.id));
  } catch (error) {
    sendDbError(res, error);
  }
});

app.put(STORE_INVENTORY_DETAIL_ROUTES, authenticate, async (req, res) => {
  try {
    const store = await dbGet('SELECT id FROM stores WHERE id = ?', [req.params.id]);
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const existing = await dbGet('SELECT * FROM products WHERE id = ?', [req.params.productId]);
    if (!existing) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const payload = {
      name: req.body.name ?? existing.name,
      sku: req.body.sku ?? existing.sku,
      barcode: req.body.barcode ?? existing.barcode,
      price: req.body.price ?? existing.price,
      cost: req.body.cost ?? existing.cost,
      quantity: req.body.quantity ?? existing.quantity,
      category_id: req.body.category_id ?? existing.category_id,
      brand_id: req.body.brand_id ?? existing.brand_id,
      unit_id: req.body.unit_id ?? existing.unit_id,
      store_id: req.params.id,
    };

    await dbRun(
      'UPDATE products SET name = ?, sku = ?, barcode = ?, price = ?, cost = ?, quantity = ?, category_id = ?, brand_id = ?, unit_id = ?, store_id = ? WHERE id = ?',
      [payload.name, payload.sku, payload.barcode, payload.price, payload.cost, payload.quantity, payload.category_id, payload.brand_id, payload.unit_id, payload.store_id, req.params.productId]
    );

    const updated = await getProductById(req.params.productId);
    res.json(updated);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(STATS_ROUTES, async (_req, res) => {
  try {
    res.json(await getStatsData());
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(REPORT_SALES_ROUTES, async (req, res) => {
  try {
    res.json(await getSalesReportRows(req.query));
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(REPORT_PRODUCTS_ROUTES, async (req, res) => {
  try {
    const rows = await getAggregatedReportRows(
      req.query,
      'pr.id, pr.name',
      'COALESCE(SUM(si.quantity), 0) AS total_sold, COALESCE(SUM(si.total), 0) AS revenue'
    );
    res.json(rows);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(REPORT_CATEGORIES_ROUTES, async (req, res) => {
  try {
    const rows = await getAggregatedReportRows(
      req.query,
      'COALESCE(c.id, 0) AS id, COALESCE(c.name, "Uncategorized") AS name',
      'COALESCE(SUM(si.quantity), 0) AS total_sold, COALESCE(SUM(si.total), 0) AS revenue'
    );
    res.json(rows);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(REPORT_STORES_ROUTES, async (req, res) => {
  try {
    const { where, params } = buildDateRangeClause(req.query, 's.created_at');
    const rows = await dbAll(
      `
        SELECT
          COALESCE(st.id, 0) AS id,
          COALESCE(st.name, 'Unassigned') AS name,
          COALESCE(COUNT(DISTINCT s.id), 0) AS total_sales,
          COALESCE(SUM(si.quantity), 0) AS total_sold,
          COALESCE(SUM(si.total), 0) AS revenue
        FROM sales s
        LEFT JOIN stores st ON st.id = s.store_id
        LEFT JOIN sale_items si ON si.sale_id = s.id
        ${where}
        GROUP BY st.id, st.name
        ORDER BY revenue DESC, total_sales DESC
      `,
      params
    );
    res.json(rows);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(AUTH_ME_ROUTES, authenticate, async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT id, full_name, username, email, role_id, status, store_id FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(await buildAuthPayload(user));
  } catch (error) {
    sendDbError(res, error);
  }
});

app.post(AUTH_LOGOUT_ROUTES, authenticate, async (req, res) => {
  try {
    if (req.token) {
      await dbRun(
        `
          UPDATE access_codes
          SET status = 'unused', used_by = NULL, active_token = NULL
          WHERE active_token = ?
        `,
        [req.token]
      );
    }

    const decoded = jwt.decode(req.token);
    const expiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now() + 8 * 60 * 60 * 1000;
    await revokeToken(req.token, expiresAt);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    sendDbError(res, error);
  }
});

registerSimpleCrud('categories', simpleTables.categories);
registerSimpleCrud('brands', simpleTables.brands);
registerSimpleCrud('units', simpleTables.units);
registerSimpleCrud('customers', simpleTables.customers);
registerSimpleCrud('suppliers', simpleTables.suppliers);
registerSimpleCrud('roles', simpleTables.roles);
registerSimpleCrud('payment_methods', simpleTables.payment_methods);
registerSimpleCrud('settings', simpleTables.settings);
registerSimpleCrud('users', simpleTables.users);
registerSimpleCrud('inventory_movements', simpleTables.inventory_movements);
app.get(PRODUCT_ROUTES, async (req, res) => {
  try {
    // Parse pagination parameters from query string
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10))); // Max 50 per page, default 10
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const searchClause = buildProductSearchClause(search);

    // Get total count
    const countResult = await dbGet(
      `SELECT COUNT(*) AS count FROM products p ${searchClause.where}`,
      searchClause.params
    );
    const total = countResult?.count || 0;

    // Get paginated products
    const products = await getProductList(limit, offset, search);

    // Return paginated response
    res.json({
      data: products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(PRODUCT_SEARCH_ROUTES, async (req, res) => {
  try {
    const lookup = String(req.query.item_code ?? req.query.itemCode ?? req.query.q ?? req.query.search ?? '').trim();

    if (!lookup) {
      res.status(400).json({ error: 'Search term or item code is required' });
      return;
    }

    const exactLookup = req.query.item_code !== undefined || req.query.itemCode !== undefined;

    if (exactLookup) {
      const product = await getProductByLookup(lookup);

      if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      res.json({
        data: [product],
        pagination: {
          page: 1,
          limit: 1,
          total: 1,
          pages: 1,
        },
      });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10)));
    const offset = (page - 1) * limit;
    const searchClause = buildProductSearchClause(lookup);

    const countResult = await dbGet(
      `SELECT COUNT(*) AS count FROM products p ${searchClause.where}`,
      searchClause.params
    );
    const total = countResult?.count || 0;
    const products = await getProductList(limit, offset, lookup);

    res.json({
      data: products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendDbError(res, error);
  }
});

app.get(PRODUCT_DETAIL_ROUTES, (req, res) => {
  getProductById(req.params.id)
    .then((row) => {
      if (!row) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      res.json(row);
    })
    .catch((error) => sendDbError(res, error));
});

app.post(PRODUCT_ROUTES, authenticate, async (req, res) => {
  const missing = validateRequired(req.body, ['name', 'price', 'quantity']);
  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    return;
  }

  try {
    const { sql, params } = buildInsert('products', productColumns, req.body);
    const result = await dbRun(sql, params);
    const row = await getProductById(result.lastID);
    res.status(201).json(row);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.put(PRODUCT_DETAIL_ROUTES, authenticate, async (req, res) => {
  try {
    const existing = await dbGet('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!existing) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const { sql, params } = buildUpdate('products', productColumns, existing, req.body);
    await dbRun(sql, params);
    const updated = await getProductById(req.params.id);
    res.json(updated);
  } catch (error) {
    sendDbError(res, error);
  }
});

app.delete(PRODUCT_DETAIL_ROUTES, authenticate, async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM products WHERE id = ?', [req.params.id]);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.json({ message: 'Product deleted' });
  } catch (error) {
    sendDbError(res, error);
  }
});

const getSaleSummaryQuery = `
  SELECT
    s.*,
    c.name AS customer_name,
    u.full_name AS user_name,
    p.name AS payment_method_name,
    st.name AS store_name
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN payment_methods p ON p.id = s.payment_method_id
  LEFT JOIN stores st ON st.id = s.store_id
`;

const getSaleDetails = async (saleId) => {
  const sale = await dbGet(`${getSaleSummaryQuery} WHERE s.id = ?`, [saleId]);
  if (!sale) {
    return null;
  }

  const items = await dbAll(
    `
      SELECT
        si.*,
        pr.name AS product_name,
        pr.sku AS product_sku,
        pr.barcode AS product_barcode
      FROM sale_items si
      LEFT JOIN products pr ON pr.id = si.product_id
      WHERE si.sale_id = ?
      ORDER BY si.id ASC
    `,
    [saleId]
  );

  return { ...sale, items };
};

const handleSaleCreate = async (req, res) => {
  const { items, ...saleBody } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items must be a non-empty array' });
    return;
  }

  try {
    const invoiceNo = saleBody.invoice_no || (await generateInvoiceNo());
    const discount = Number(saleBody.discount ?? 0);
    const tax = Number(saleBody.tax ?? 0);
    const paymentMethodId = saleBody.payment_method_id ?? null;
    const customerId = saleBody.customer_id ?? null;
    const userId = saleBody.user_id ?? req.user?.id ?? null;
    const authUser = req.user?.id ? await dbGet('SELECT store_id FROM users WHERE id = ?', [req.user.id]) : null;
    const storeId = saleBody.store_id ?? authUser?.store_id ?? null;

    if (!storeId) {
      const error = new Error('store_id is required');
      error.status = 400;
      throw error;
    }

    await dbRun('BEGIN IMMEDIATE TRANSACTION');

    let subtotal = 0;
    const resolvedItems = [];

    for (const item of items) {
      if (!item.product_id || !item.quantity) {
        const error = new Error('Each item must include product_id and quantity');
        error.status = 400;
        throw error;
      }

      const product = await dbGet('SELECT * FROM products WHERE id = ?', [item.product_id]);
      if (!product) {
        const error = new Error(`Product ${item.product_id} not found`);
        error.status = 400;
        throw error;
      }

      const quantity = Number(item.quantity);
      const price = Number(item.price ?? product.price);
      const lineTotal = price * quantity;

      if (Number(product.quantity) < quantity) {
        const error = new Error(`Insufficient stock for ${product.name}`);
        error.status = 400;
        throw error;
      }

      subtotal += lineTotal;
      resolvedItems.push({ product, quantity, price, total: lineTotal });
    }

    const total = subtotal - discount + tax;
    const amountPaid = Number(saleBody.amount_paid ?? 0);
    const changeAmount = Number(saleBody.change_amount ?? Math.max(amountPaid - total, 0));

    const saleResult = await dbRun(
      'INSERT INTO sales (invoice_no, customer_id, user_id, store_id, subtotal, discount, tax, total, payment_method_id, amount_paid, change_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [invoiceNo, customerId, userId, storeId, subtotal, discount, tax, total, paymentMethodId, amountPaid, changeAmount]
    );

    const saleId = saleResult.lastID;

    for (const item of resolvedItems) {
      await dbRun(
        'INSERT INTO sale_items (sale_id, product_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)',
        [saleId, item.product.id, item.quantity, item.price, item.total]
      );

      await dbRun('UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.product.id]);

      await dbRun(
        'INSERT INTO inventory_movements (product_id, movement_type, quantity, note) VALUES (?, ?, ?, ?)',
        [item.product.id, 'sale', item.quantity, `Sale ${invoiceNo}`]
      );
    }

    await dbRun('COMMIT');

    const createdSale = await getSaleDetails(saleId);
    res.status(201).json(createdSale);
  } catch (error) {
    await dbRun('ROLLBACK').catch(() => {});
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    sendDbError(res, error);
  }
};

app.get(SALES_ROUTES, (_req, res) => {
  dbAll(`${getSaleSummaryQuery} ORDER BY s.id DESC`)
    .then((rows) => res.json(rows))
    .catch((error) => sendDbError(res, error));
});

app.get(SALES_DETAIL_ROUTES, (req, res) => {
  getSaleDetails(req.params.id)
    .then((sale) => {
      if (!sale) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }

      res.json(sale);
    })
    .catch((error) => sendDbError(res, error));
});

app.post(SALES_ROUTES, authenticate, requireRoleNames(ALLOWED_SALE_ROLES), handleSaleCreate);

const handleLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const user = await dbGet('SELECT id, full_name, username, email, password, role_id, status, store_id FROM users WHERE email = ?', [email]);
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    res.json(await buildAuthPayload(user));
  } catch (error) {
    sendDbError(res, error);
  }
};

app.post(LOGIN_ROUTES, authLimiter, handleLogin);

const handlePasswordResetRequest = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const user = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) {
      res.json({ message: 'If that email exists, a reset token was generated' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 60 * 60 * 1000;

    await dbRun('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, user.id]);
    res.json({ message: 'Password reset token generated', token });
  } catch (error) {
    sendDbError(res, error);
  }
};

const handlePasswordReset = async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      res.status(400).json({ error: 'Token and new_password required' });
      return;
    }

    const user = await dbGet('SELECT id, reset_expires FROM users WHERE reset_token = ?', [token]);
    if (!user || !user.reset_expires || Number(user.reset_expires) < Date.now()) {
      res.status(400).json({ error: 'Invalid or expired token' });
      return;
    }

    const hash = await hashPassword(new_password);
    await dbRun('UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [hash, user.id]);
    res.json({ message: 'Password has been reset' });
  } catch (error) {
    sendDbError(res, error);
  }
};

app.post(PASSWORD_RESET_REQUEST_ROUTES, authLimiter, handlePasswordResetRequest);
app.post(PASSWORD_RESET_ROUTES, authLimiter, handlePasswordReset);

// Register mismatched categories report routes
const mismatchedRoute = '/reports/mismatched-categories';
const mismatchedHandler = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '100', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const result = await getMismatchedCategories(limit, offset);
    res.json(result);
  } catch (error) {
    sendDbError(res, error);
  }
};

for (const variant of routeVariants(mismatchedRoute)) {
  app.get(variant, mismatchedHandler);
}

// Map products to categories and optionally create missing categories
// Body: { mappings: [{ item_code: string, category: string }], createMissing: boolean }
const mapCategoriesHandler = async (req, res) => {
  try {
    const { mappings, createMissing = true } = req.body || {};
    if (!Array.isArray(mappings) || mappings.length === 0) {
      res.status(400).json({ error: 'mappings array required' });
      return;
    }

    const created = new Map();
    const errors = [];
    let updatedCount = 0;

    const result = await withTransaction(async () => {
      for (const m of mappings) {
        const itemCode = (m.item_code || m.barcode || '').toString().trim();
        const categoryName = (m.category || '').toString().trim();

        if (!itemCode || !categoryName) {
          errors.push({ mapping: m, error: 'item_code and category required' });
          continue;
        }

        // Ensure category exists
        let category = await dbGet('SELECT id FROM categories WHERE name = ?', [categoryName]);
        if (!category && createMissing) {
          await dbRun('INSERT OR IGNORE INTO categories (name) VALUES (?)', [categoryName]);
          category = await dbGet('SELECT id FROM categories WHERE name = ?', [categoryName]);
          if (category) created.set(categoryName, category.id);
        }

        if (!category) {
          errors.push({ mapping: m, error: `category not found: ${categoryName}` });
          continue;
        }

        const updateRes = await dbRun('UPDATE products SET category_id = ? WHERE item_code = ? OR barcode = ?', [category.id, itemCode, itemCode]);
        updatedCount += updateRes.changes || 0;
      }

      return { created: Array.from(created.entries()).map(([name, id]) => ({ name, id })), updated: updatedCount, errors };
    });

    res.json({ success: true, ...result });
  } catch (error) {
    sendDbError(res, error);
  }
};

for (const variant of routeVariants('/products/map-categories')) {
  app.post(variant, authenticate, mapCategoriesHandler);
}

app.post(CHANGE_PASSWORD_ROUTES, authenticate, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) {
      res.status(400).json({ error: 'old_password and new_password required' });
      return;
    }

    const user = await dbGet('SELECT id, password FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const ok = await bcrypt.compare(old_password, user.password);
    if (!ok) {
      res.status(401).json({ error: 'Old password incorrect' });
      return;
    }

    const hash = await hashPassword(new_password);
    await dbRun('UPDATE users SET password = ? WHERE id = ?', [hash, user.id]);
    res.json({ message: 'Password changed' });
  } catch (error) {
    sendDbError(res, error);
  }
});

const ensureProductBarcodeColumns = async () => {
  const columns = await dbAll('PRAGMA table_info(products)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('item_code')) {
    await dbRun('ALTER TABLE products ADD COLUMN item_code TEXT');
  }

  if (!columnNames.has('barcode')) {
    await dbRun('ALTER TABLE products ADD COLUMN barcode TEXT');
  }
};

const startServer = async () => {
  try {
    await ensureProductBarcodeColumns();

    const server = app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the other server or change PORT.`);
        process.exitCode = 1;
        return;
      }

      console.error('Server failed to start:', error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  }
};

startServer();
