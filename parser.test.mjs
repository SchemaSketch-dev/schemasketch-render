// Tests for the DBML parser the renderer draws from. parser.js is copied from
// frontend/ (see scripts/sync.mjs); these tests ship with the package so the
// public repository checks the parser on its own.
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
