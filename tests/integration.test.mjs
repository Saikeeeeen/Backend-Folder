import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const adminEmail = 'admin@local';
const adminPassword = 'itest-pass-123';
const jsonHeaders = { 'content-type': 'application/json' };
let adminToken;

const fetchJson = (path, options = {}) =>
  fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...jsonHeaders,
      ...(options.headers ?? {}),
    },
  });

const login = (email, password) =>
  fetchJson('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

test('auth: reset admin password and capture token', async () => {
  const requestRes = await fetchJson('/api/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email: adminEmail }),
  });
  assert.equal(requestRes.status, 200);
  const requestJson = await requestRes.json();
  assert.ok(requestJson.token, 'reset token should be returned in dev mode');

  const resetRes = await fetchJson('/api/password-reset/reset', {
    method: 'POST',
    body: JSON.stringify({ token: requestJson.token, new_password: adminPassword }),
  });
  assert.equal(resetRes.status, 200);

  const loginRes = await login(adminEmail, adminPassword);
  assert.equal(loginRes.status, 200);
  const loginJson = await loginRes.json();
  assert.ok(loginJson.token, 'token should be present');
  adminToken = loginJson.token;
});

test('auth: access code login works without email', async () => {
  assert.ok(adminToken, 'missing admin token from auth setup');

  const bootstrapRes = await fetch(`${base}/api/bootstrap`);
  assert.equal(bootstrapRes.status, 200);
  const bootstrap = await bootstrapRes.json();

  const branchUser = bootstrap.users.find((user) => user.store_id);
  assert.ok(branchUser, 'expected at least one user assigned to a store');

  const branchStoreId = branchUser.store_id;
  const createRes = await fetchJson(`/api/stores/${branchStoreId}/access-codes`, {
    method: 'POST',
    headers: authHeaders(adminToken),
  });

  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.ok(created.code, 'generated access code should be returned');

  const verifyRes = await fetchJson('/api/access-codes/verify', {
    method: 'POST',
    body: JSON.stringify({ code: created.code }),
  });

  assert.equal(verifyRes.status, 200);
  const verified = await verifyRes.json();
  assert.equal(verified.store_id, branchStoreId);
  assert.ok(verified.token, 'access-code login should return a token');

  const regenerateRes = await fetchJson(`/api/stores/${branchStoreId}/access-codes/regenerate`, {
    method: 'POST',
    headers: authHeaders(adminToken),
  });

  assert.equal(regenerateRes.status, 201);
  const regenerated = await regenerateRes.json();
  assert.ok(regenerated.code, 'regenerated access code should be returned');
  assert.notEqual(regenerated.code, created.code, 'regenerated code should be new');

  const oldCodeRes = await fetchJson('/api/access-codes/verify', {
    method: 'POST',
    body: JSON.stringify({ code: created.code }),
  });

  assert.equal(oldCodeRes.status, 200, 'previous code should still work after regeneration');

  const newCodeRes = await fetchJson('/api/access-codes/verify', {
    method: 'POST',
    body: JSON.stringify({ code: regenerated.code }),
  });

  assert.equal(newCodeRes.status, 200, 'new regenerated code should work');
});

test('auth: protected product create needs a token', async () => {
  const res = await fetchJson('/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Should Fail', price: 1, quantity: 1 }),
  });

  assert.equal(res.status, 401);
});

test('products: admin can create and remove a product', async () => {
  assert.ok(adminToken, 'missing admin token from auth setup');

  const name = `IT-test-${Date.now()}`;
  const createRes = await fetchJson('/api/products', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ name, price: 9.99, quantity: 5 }),
  });

  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.name, name);

  const deleteRes = await fetch(`${base}/api/products/${created.id}`, {
    method: 'DELETE',
    headers: authHeaders(adminToken),
  });
  assert.equal(deleteRes.status, 200);
});

test('barcode: lookup works with query param', async () => {
  assert.ok(adminToken, 'missing admin token from auth setup');

  const barcode = `BC-${Date.now()}`;
  const name = `Barcode Test ${Date.now()}`;
  let createdId;

  try {
    const createRes = await fetchJson('/api/products', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        name,
        price: 4.5,
        quantity: 1,
        barcode,
      }),
    });

    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    createdId = created.id;

    const lookupRes = await fetch(`${base}/api/products/scan?barcode=${encodeURIComponent(barcode)}`);
    assert.equal(lookupRes.status, 200);

    const lookupJson = await lookupRes.json();
    assert.equal(lookupJson.success, true);
    assert.equal(lookupJson.product.id, created.id);
    assert.equal(lookupJson.product.barcode, barcode);
  } finally {
    if (createdId) {
      await fetch(`${base}/api/products/${createdId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
      }).catch(() => {});
    }
  }
});

test('products: search matches barcode and item code', async () => {
  assert.ok(adminToken, 'missing admin token from auth setup');

  const barcode = `SRCH-${Date.now()}`;
  let createdId;

  try {
    const createRes = await fetchJson('/api/products', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        name: `Search Test ${Date.now()}`,
        price: 7.5,
        quantity: 3,
        barcode,
        sku: `SKU-${Date.now()}`,
      }),
    });

    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    createdId = created.id;

    const searchRes = await fetch(`${base}/api/products?page=1&limit=50&search=${encodeURIComponent(barcode)}`);
    assert.equal(searchRes.status, 200);

    const searchJson = await searchRes.json();
    const rows = Array.isArray(searchJson) ? searchJson : searchJson.data || [];

    assert.ok(rows.some((row) => row.barcode === barcode || row.item_code === barcode), 'expected barcode search to return the created product');
  } finally {
    if (createdId) {
      await fetch(`${base}/api/products/${createdId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
      }).catch(() => {});
    }
  }
});

test('sales: manager role cannot create sales', async () => {
  assert.ok(adminToken, 'missing admin token from auth setup');

  const bootstrapRes = await fetch(`${base}/api/bootstrap`);
  assert.equal(bootstrapRes.status, 200);
  const bootstrap = await bootstrapRes.json();
  const managerRole = bootstrap.roles.find((role) => role.name === 'Manager');
  assert.ok(managerRole, 'Manager role should exist');

  const email = `manager-${Date.now()}@local`;
  let managerUserId;

  try {
    const createRes = await fetchJson('/api/users', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        full_name: 'Test Manager',
        email,
        password: 'manager-pass-123',
        role_id: managerRole.id,
      }),
    });

    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    managerUserId = created.id;

    const loginRes = await login(email, 'manager-pass-123');
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.ok(loginJson.token, 'manager login should return a token');

    const salesRes = await fetchJson('/api/sales', {
      method: 'POST',
      headers: authHeaders(loginJson.token),
      body: JSON.stringify({ items: [] }),
    });

    assert.equal(salesRes.status, 403);
  } finally {
    if (managerUserId) {
      await fetch(`${base}/api/users/${managerUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
      }).catch(() => {});
    }
  }
});

test('sales: admin can create a sale', async () => {
  assert.ok(adminToken, 'missing admin token from auth setup');

  const productsRes = await fetch(`${base}/api/products`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(productsRes.status, 200);
  const productsJson = await productsRes.json();
  const products = Array.isArray(productsJson) ? productsJson : productsJson.data || [];
  const product = products.find((item) => Number(item.quantity ?? 0) > 0) || products[0];
  assert.ok(product, 'expected at least one product with stock');
  const saleRes = await fetchJson('/api/sales', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      customer_id: null,
      payment_method_id: null,
      amount_paid: 100,
      items: [
        {
          product_id: product.id,
          quantity: 1,
          price: Number(product.price),
        },
      ],
    }),
  });

  assert.equal(saleRes.status, 201);
  const sale = await saleRes.json();
  assert.ok(sale.id, 'sale id should be present');
  assert.ok(Array.isArray(sale.items), 'sale items should be returned');
  assert.equal(sale.items.length, 1);
});
