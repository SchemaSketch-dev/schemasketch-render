// Tests for the DBML parser (frontend/parser.js), which the editor, the exports,
// the MCP server and schemasketch-render all use. packages/schemasketch-render/
// scripts/sync.mjs copies this file next to the package's parser.js, so the
// public schemasketch-render repository runs it too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchema } from './parser.js';

const SHOP = `
Enum order_status {
  pending
  paid
}

Table users [headercolor: #3498db] {
  id int [pk, increment]
  email varchar [unique, not null]
  Note: 'people who buy things'
}

Table orders {
  id int [pk]
  user_id int [ref: > users.id]
  status order_status [default: 'pending']
}

Ref: orders.id < users.id

TableGroup sales {
  orders
}
`;

test('tables, columns and their attributes', () => {
  const { tables, errors } = parseSchema(SHOP);
  assert.deepEqual(errors, []);
  assert.deepEqual(tables.map((t) => t.name), ['users', 'orders']);

  const users = tables[0];
  assert.equal(users.color, '#3498db');
  assert.equal(users.note, 'people who buy things');
  const [id, email] = users.columns;
  assert.equal(id.type, 'int');
  assert.ok(id.pk && id.increment && !id.notNull);
  assert.ok(email.unique && email.notNull && !email.pk);

  const status = tables[1].columns.find((c) => c.name === 'status');
  assert.equal(status.type, 'order_status');
  assert.equal(status.default, 'pending');
});

test('enums', () => {
  const { enums } = parseSchema(SHOP);
  assert.deepEqual(enums, [{ name: 'order_status', values: ['pending', 'paid'] }]);
});

test('inline refs and standalone refs both become refs', () => {
  const { refs, tables } = parseSchema(SHOP);
  const inline = refs.find((r) => r.fromColumn === 'user_id');
  assert.deepEqual(
    { ...inline },
    { fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id', type: '>' },
  );
  assert.ok(refs.some((r) => r.fromTable === 'orders' && r.fromColumn === 'id' && r.type === '<'));
  assert.equal(tables[1].columns.find((c) => c.name === 'user_id').inlineRef, '> users.id');
});

test('table groups', () => {
  const { tableGroups } = parseSchema(SHOP);
  assert.equal(tableGroups.length, 1);
  assert.equal(tableGroups[0].name, 'sales');
  assert.deepEqual(tableGroups[0].tables, ['orders']);
});

test('broken DBML reports an error and keeps what parsed', () => {
  const { tables, errors } = parseSchema('Table ok {\n  id int\n}\nTable broken {\n  id int [pk\n');
  assert.ok(errors.length > 0, 'expected a parse error');
  assert.ok(tables.some((t) => t.name === 'ok'), 'the complete table should still be there');
});

test('empty and whitespace-only input give an empty schema, not a crash', () => {
  for (const input of ['', '   \n\n  ']) {
    const schema = parseSchema(input);
    assert.deepEqual(schema.tables, []);
    assert.deepEqual(schema.refs, []);
    assert.deepEqual(schema.errors, []);
  }
});

// ---- Schemas (Postgres-style schema.table names) ----

const SCHEMAS = `
Table public.users {
  id int [pk]
}

Table billing.invoices {
  id int [pk]
  user_id int [ref: > public.users.id]
}

Table billing.payments {
  id int [pk]
  invoice_id int
}

Ref: billing.payments.invoice_id > billing.invoices.id
`;

const ref = (refs, fromTable, fromColumn) =>
  refs.find((r) => r.fromTable === fromTable && r.fromColumn === fromColumn);

test('inline refs between schema-qualified tables keep the schema', () => {
  const { refs, errors } = parseSchema(SCHEMAS);
  assert.deepEqual(errors, []);
  const r = ref(refs, 'billing.invoices', 'user_id');
  assert.equal(r.toTable, 'public.users');
  assert.equal(r.toColumn, 'id');
});

test('standalone Ref lines between schema-qualified tables keep the schema', () => {
  const r = ref(parseSchema(SCHEMAS).refs, 'billing.payments', 'invoice_id');
  assert.ok(r, 'the ref should keep billing.payments as its from-table');
  assert.equal(r.toTable, 'billing.invoices');
});

test('public is the default schema: users and public.users are the same table', () => {
  const qualifiedTable = parseSchema('Table public.users {\n  id int [pk]\n}\nTable posts {\n  user_id int [ref: > users.id]\n}');
  assert.equal(ref(qualifiedTable.refs, 'posts', 'user_id').toTable, 'public.users');

  const plainTable = parseSchema('Table users {\n  id int [pk]\n}\nTable posts {\n  user_id int [ref: > public.users.id]\n}');
  assert.equal(ref(plainTable.refs, 'posts', 'user_id').toTable, 'users');
});

test('the same table name in two schemas: each ref goes to the schema it names', () => {
  const { refs } = parseSchema(`
Table public.users {
  id int [pk]
}
Table audit.users {
  id int [pk]
}
Table audit.events {
  id int [pk]
  actor_id int [ref: > audit.users.id]
  subject_id int [ref: > public.users.id]
}`);
  assert.equal(ref(refs, 'audit.events', 'actor_id').toTable, 'audit.users');
  assert.equal(ref(refs, 'audit.events', 'subject_id').toTable, 'public.users');
});

test('quoted schema and table names in refs', () => {
  const { refs } = parseSchema('Table "billing"."invoices" {\n  id int [pk]\n}\nTable "billing"."lines" {\n  invoice_id int\n}\nRef: "billing"."lines".invoice_id > "billing"."invoices".id');
  const r = ref(refs, 'billing.lines', 'invoice_id');
  assert.ok(r, 'the ref should resolve billing.lines');
  assert.equal(r.toTable, 'billing.invoices');
});

test('schema-qualified composite refs keep the schema', () => {
  const { refs } = parseSchema('Table sales.orders {\n  id int\n  region int\n}\nTable sales.lines {\n  order_id int\n  region int\n}\nRef: sales.lines.(order_id, region) > sales.orders.(id, region)');
  const r = ref(refs, 'sales.lines', 'order_id');
  assert.ok(r, 'the ref should resolve sales.lines');
  assert.equal(r.toTable, 'sales.orders');
});

test('table groups list schema-qualified tables', () => {
  const { tableGroups } = parseSchema(SCHEMAS + '\nTableGroup billing {\n  billing.invoices\n  billing.payments\n}');
  assert.deepEqual(tableGroups[0].tables, ['billing.invoices', 'billing.payments']);
});
