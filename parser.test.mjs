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
    { fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id', type: '>', fromColumns: ['user_id'], toColumns: ['id'] },
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

// ---- Named relationships (Ref name: …, Ref name { … }) ----

const TWO = 'Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int\n}\n';

test('a named Ref line is kept, with its name', () => {
  const { refs, errors } = parseSchema(TWO + 'Ref fk_b_a: b.a_id > a.id');
  assert.deepEqual(errors, []);
  assert.equal(refs.length, 1);
  assert.deepEqual(
    { ...refs[0] },
    { fromTable: 'b', fromColumn: 'a_id', toTable: 'a', toColumn: 'id', type: '>', fromColumns: ['a_id'], toColumns: ['id'], name: 'fk_b_a' },
  );
});

test('a named Ref line followed by a table does not swallow that table', () => {
  const { tables, refs } = parseSchema('Table a {\n  id int [pk]\n}\nRef fk_c_a: c.a_id > a.id\nTable c {\n  id int [pk]\n  a_id int\n}');
  assert.deepEqual(tables.map((t) => t.name), ['a', 'c']);
  assert.equal(tables[1].columns.length, 2);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].name, 'fk_c_a');
});

test('a named Ref keeps its settings', () => {
  const { refs } = parseSchema(TWO + 'Ref fk_b_a: b.a_id > a.id [delete: cascade]');
  assert.equal(refs[0].onDelete, 'cascade');
  assert.equal(refs[0].name, 'fk_b_a');
});

test('a quoted Ref name', () => {
  const { refs } = parseSchema(TWO + 'Ref "b to a": b.a_id > a.id');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].name, 'b to a');
});

test('a named Ref block keeps the name on its refs', () => {
  const { refs } = parseSchema(TWO + 'Ref fk_b_a {\n  b.a_id > a.id\n}');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].name, 'fk_b_a');
});

test('unnamed refs have no name', () => {
  const { refs } = parseSchema(TWO + 'Ref: b.a_id > a.id');
  assert.equal(refs.length, 1);
  assert.equal('name' in refs[0], false);
});

// ---- Composite refs (Ref: b.(x, y) > a.(x, y)) ----

const PAIR_KEYS = 'Table a {\n  id int\n  k int\n}\nTable b {\n  a_id int\n  a_k int\n}\n';

test('composite refs keep every column', () => {
  const { refs, errors } = parseSchema(PAIR_KEYS + 'Ref: b.(a_id, a_k) > a.(id, k)');
  assert.deepEqual(errors, []);
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0].fromColumns, ['a_id', 'a_k']);
  assert.deepEqual(refs[0].toColumns, ['id', 'k']);
  // the first column stays in fromColumn/toColumn for code that reads one column
  assert.equal(refs[0].fromColumn, 'a_id');
  assert.equal(refs[0].toColumn, 'id');
});

test('single-column refs also list their column', () => {
  const { refs } = parseSchema(PAIR_KEYS + 'Ref: b.a_id > a.id\nTable c {\n  b_id int [ref: > b.a_id]\n}');
  for (const r of refs) {
    assert.deepEqual(r.fromColumns, [r.fromColumn]);
    assert.deepEqual(r.toColumns, [r.toColumn]);
  }
});

test('composite refs with quoted columns', () => {
  const { refs } = parseSchema(PAIR_KEYS + 'Ref: b.("a_id", "a_k") > a.("id", "k")');
  assert.deepEqual(refs[0].fromColumns, ['a_id', 'a_k']);
  assert.deepEqual(refs[0].toColumns, ['id', 'k']);
});

// ---- TablePartial (shared columns injected with ~name) ----
// Spec: the table's own fields, settings and indexes win; between partials the
// last injected wins. Injected columns sit where their ~name line is.

const PARTIALS = `
TablePartial base [headercolor: #ff0000] {
  id int [pk]
  created_at timestamp
}
TablePartial soft_delete {
  deleted_at timestamp
}
`;

const cols = (table) => table.columns.map((c) => `${c.name}:${c.type}`);

test('partials inject their columns where the ~name line is', () => {
  const { tables, errors } = parseSchema(PARTIALS + 'Table users {\n  ~base\n  name varchar\n  ~soft_delete\n}');
  assert.deepEqual(errors, []);
  assert.deepEqual(cols(tables[0]), ['id:int', 'created_at:timestamp', 'name:varchar', 'deleted_at:timestamp']);
  assert.equal(tables[0].columns[0].pk, true);
});

test('a partial is not a table of its own', () => {
  const { tables } = parseSchema(PARTIALS + 'Table users {\n  ~base\n}');
  assert.deepEqual(tables.map((t) => t.name), ['users']);
});

test("the table's own column wins over a partial's", () => {
  const { tables } = parseSchema(PARTIALS + 'Table users {\n  ~base\n  id bigint [pk, increment]\n}');
  assert.deepEqual(cols(tables[0]), ['id:bigint', 'created_at:timestamp']);
  assert.equal(tables[0].columns[0].increment, true);
});

test('between partials, the last injected wins', () => {
  const { tables } = parseSchema(PARTIALS + 'TablePartial wide_id {\n  id uuid [pk]\n}\nTable users {\n  ~base\n  ~wide_id\n}');
  assert.deepEqual(cols(tables[0]), ['id:uuid', 'created_at:timestamp']);
});

test('table settings come from a partial unless the table sets them', () => {
  const inherited = parseSchema(PARTIALS + 'Table users {\n  ~base\n}');
  assert.equal(inherited.tables[0].color, '#ff0000');
  const own = parseSchema(PARTIALS + 'Table users [headercolor: #0000ff] {\n  ~base\n}');
  assert.equal(own.tables[0].color, '#0000ff');
});

test('partial indexes are merged into the table', () => {
  const { tables } = parseSchema('TablePartial with_email {\n  email varchar\n  indexes {\n    email [unique]\n  }\n}\nTable users {\n  id int [pk]\n  ~with_email\n}');
  assert.deepEqual(tables[0].indexes.map((i) => ({ columns: i.columns, unique: i.unique })), [{ columns: ['email'], unique: true }]);
});

test('an inline ref in a partial applies to every table that injects it', () => {
  const { refs } = parseSchema('Table users {\n  id int [pk]\n}\nTablePartial owned {\n  owner_id int [ref: > users.id]\n}\nTable posts {\n  id int [pk]\n  ~owned\n}\nTable files {\n  id int [pk]\n  ~owned\n}');
  assert.deepEqual(refs.map((r) => `${r.fromTable}.${r.fromColumn}>${r.toTable}.${r.toColumn}`).sort(), ['files.owner_id>users.id', 'posts.owner_id>users.id']);
});

test('a partial can be defined after the table that uses it', () => {
  const { tables, errors } = parseSchema('Table users {\n  ~base\n  name varchar\n}\n' + PARTIALS);
  assert.deepEqual(errors, []);
  assert.deepEqual(cols(tables[0]), ['id:int', 'created_at:timestamp', 'name:varchar']);
});

test('tables that inject the same partial get their own copies of its columns', () => {
  const { tables } = parseSchema(PARTIALS + 'Table a {\n  ~base\n}\nTable b {\n  ~base\n}');
  tables[0].columns[0].note = 'changed';
  assert.equal(tables[1].columns[0].note, null);
});

test('an unknown partial is an error, not silently dropped', () => {
  const { errors } = parseSchema('Table users {\n  ~missing\n  id int\n}');
  assert.ok(errors.some((e) => /unknown TablePartial "missing"/.test(e)), JSON.stringify(errors));
});

test('a partial that injects another partial is an error', () => {
  const { errors } = parseSchema(PARTIALS + 'TablePartial nested {\n  ~base\n}\nTable t {\n  ~nested\n}');
  assert.ok(errors.some((e) => /TablePartial nested/.test(e)), JSON.stringify(errors));
});
