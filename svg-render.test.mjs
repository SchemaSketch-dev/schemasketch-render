// Run with: node --test 'frontend/**/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchema } from './parser.js';
import { TEMPLATES } from './templates.js';
import { renderSvg, measureTable, layout, esc, messageSvg } from './svg-render.js';

const SAAS = TEMPLATES.find((t) => t.id === 'saas-starter').dbml;

// Tag-balance check: strips text/attribute contents, then walks a stack.
function assertBalanced(svg) {
  const stripped = svg.replace(/"[^"]*"/g, '""');
  const tags = stripped.match(/<[^>]*>/g) || [];
  const stack = [];
  for (const t of tags) {
    if (t.startsWith('<?') || t.startsWith('<!')) continue;
    if (t.startsWith('</')) {
      const name = t.slice(2, -1).trim();
      assert.equal(stack.pop(), name, `unbalanced near ${t}`);
    } else if (!t.endsWith('/>')) {
      stack.push(t.slice(1).split(/[\s>]/)[0]);
    }
  }
  assert.deepEqual(stack, []);
  // Nothing but tags and text: no stray angle brackets inside text.
  const text = stripped.replace(/<[^>]*>/g, '');
  assert.ok(!/[<>]/.test(text), 'stray angle bracket in text');
}

function viewBox(svg) {
  const m = svg.match(/viewBox="([^"]*)"/);
  assert.ok(m, 'viewBox present');
  const nums = m[1].split(' ').map(Number);
  assert.equal(nums.length, 4);
  for (const n of nums) assert.ok(Number.isFinite(n), `finite viewBox: ${m[1]}`);
  return nums;
}

test('renders one <g class="ss-table"> per table and one row per column', () => {
  const schema = parseSchema(SAAS);
  const svg = renderSvg(schema, {}, { title: 'SaaS' });
  assert.equal((svg.match(/<g class="ss-table"/g) || []).length, schema.tables.length);
  const cols = schema.tables.reduce((n, t) => n + t.columns.length, 0);
  assert.equal((svg.match(/<g class="ss-row"/g) || []).length, cols);
});

test('output is well-formed XML with a <title>', () => {
  const svg = renderSvg(parseSchema(SAAS), {}, { title: 'A & B <x>' });
  assertBalanced(svg);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('<title>A &amp; B &lt;x&gt;</title>'));
});

test('table width matches the editor', () => {
  // Editor formula (renderer.js measureTable): chars*7.2 (+1.2 bold), name adds
  // PAD_X*2 + 74 header icons, rows add PAD_X*2 + 54, badges 20 each + 3 gaps + 8.
  const schema = parseSchema(`Table orders {
  id int [pk, increment]
  customer_reference_code varchar(64) [not null, unique, default: 'pending']
}`);
  const t = schema.tables[0];
  // row 2: label 23+3+11=37 chars -> 266.4; default " = pending" 10 chars -> 72; badges 2*20+3+8=51; +28+54
  // = 266.4 + 72 + 51 + 82 = 471.4 -> 471
  const m = measureTable(t);
  assert.equal(m.w, 471);
  assert.equal(m.h, 32 + 2 * 26);
  assert.equal(measureTable(parseSchema('Table a { id int }').tables[0]).w, 160);
});

test('table width: bold name can be the widest element', () => {
  const schema = parseSchema('Table a_really_long_table_name_here { id int }');
  // 29 chars * (7.2 + 1.2) = 243.6 + 28 + 74 = 345.6 -> 346 (row: 6*7.2+82 = 125.2)
  assert.equal(measureTable(schema.tables[0]).w, 346);
});

test('layout places unpositioned tables below positioned ones', () => {
  const schema = parseSchema('Table a { id int }\nTable b { id int\n x int }\nTable c { id int }');
  const pos = layout(schema, { a: { x: 40, y: 40 } });
  const h = measureTable(schema.tables[0]).h;
  assert.deepEqual(pos.a, { x: 40, y: 40 });
  for (const n of ['b', 'c']) assert.ok(pos[n].y >= 40 + h + 70, `${n} below a`);
  const rects = schema.tables.map((t) => ({ ...pos[t.name], ...measureTable(t) }));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlap, 'no overlap');
  }
});

test('positions may be [] or null', () => {
  const schema = parseSchema(SAAS);
  const base = renderSvg(schema, {}, { title: 't' });
  assert.equal(renderSvg(schema, [], { title: 't' }), base);
  assert.equal(renderSvg(schema, null, { title: 't' }), base);
});

test('garbage positions are coerced', () => {
  const schema = parseSchema('Table a { id int }\nTable b { id int }\nTable c { id int }\nTable d { id int }');
  const svg = renderSvg(schema, {
    a: { x: 'abc', y: 1 }, b: { x: NaN, y: 0 }, c: { x: 1e308, y: 1e308 }, d: { x: -50, y: -50 },
  });
  viewBox(svg);
  assert.ok(!/NaN|Infinity|e\+/.test(svg));
  const pos = layout(schema, { a: { x: 'abc', y: 1 }, b: { x: NaN, y: 0 }, c: { x: 1e308, y: 1e308 } });
  for (const n of ['a', 'b', 'c']) {
    assert.ok(Number.isFinite(pos[n].x) && Number.isFinite(pos[n].y));
    assert.ok(Math.abs(pos[n].x) < 1e6 && Math.abs(pos[n].y) < 1e6);
  }
});

test('empty diagram renders a non-zero "Empty diagram" card', () => {
  const svg = renderSvg(parseSchema(''), {}, { title: 'x' });
  assert.ok(svg.includes('Empty diagram'));
  const [, , w, h] = viewBox(svg);
  assert.ok(w > 0 && h > 0);
  assertBalanced(svg);
});

test('over 300 tables renders the too-large card', () => {
  const src = Array.from({ length: 301 }, (_, i) => `Table t${i} { id int }`).join('\n');
  const svg = renderSvg(parseSchema(src), {}, {});
  assert.ok(svg.includes('Diagram too large to preview'));
  assert.ok(!svg.includes('class="ss-table"'));
  assertBalanced(svg);
});

test('hostile content is escaped', () => {
  const evil = [
    "users'.system('PWNED_table').'",
    '</text><script>alert(1)</script>',
    '" onload="x',
    'javascript:x',
    'url(http://e)',
    '😀 emoji',
    'n'.repeat(200),
  ];
  const parts = [];
  evil.forEach((e, i) => {
    const q = (s) => `"${s.replace(/"/g, '')}"`;
    parts.push(`Table ${q(e)} [headercolor: red; x] {\n  ${q(e)} ${q(e)} [note: '${e.replace(/'/g, '')}']\n}`);
    parts.push(`Table safe${i} { id int [pk] }`);
  });
  const schema = parseSchema(parts.join('\n'));
  assert.ok(schema.tables.length > 0);
  // Also inject directly, bypassing the parser's own filtering.
  schema.tables.push({ name: '</text><script>alert(1)</script>', columns: [
    { name: '" onload="x', type: 'url(http://e)', pk: true, default: 'javascript:x' },
  ], indexes: [], note: '<b>', color: 'url(x)' });
  schema.tableGroups = [{ name: '</g><script>', color: 'red', tables: [] }];
  const svg = renderSvg(schema, { [schema.tables[0].name]: { x: '"><script>', y: 1 } }, { title: evil.join(' ') });
  assert.ok(!svg.includes('<script'));
  assert.ok(!/ on[a-z]+=/i.test(svg), 'no event handler attribute');
  assert.ok(!svg.includes('href'));
  assert.ok(!svg.includes('url('));
  assert.ok(!svg.includes('javascript:'));
  assert.ok(!/NaN|Infinity/.test(svg));
  assertBalanced(svg);
  viewBox(svg);
  for (const t of schema.tables) assert.ok(Number.isFinite(measureTable(t).w));
});

test('bad colours fall back', () => {
  for (const color of ['red; x', 'url(x)']) {
    const schema = parseSchema('Table a { id int }');
    schema.tables[0].color = color;
    const svg = renderSvg(schema, {}, {});
    assert.ok(svg.includes('#5b6cf0'));
    assert.ok(!svg.includes('red'));
    assert.ok(!svg.includes('url('));
  }
  const ok = parseSchema('Table a [headercolor: #ff0000] { id int }');
  assert.ok(renderSvg(ok, {}, {}).includes('#ff0000'));
});

test('esc and messageSvg', () => {
  assert.equal(esc(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  assert.equal(esc('a=b url(x) JavaScript:y'), 'a&#61;b url&#40;x) JavaScript&#58;y');
  assert.equal(esc(null), '');
  const m = messageSvg('Can\'t show <this>');
  assertBalanced(m);
  assert.ok(m.includes('width="400"') && m.includes('height="120"'));
});

// ---- Task 2: relationships, table groups, themes ----

const PAIR = `Table users { id int [pk]\n name varchar }
Table posts { id int [pk]\n user_id int }
Ref: posts.user_id > users.id`;
const PAIR_POS = { users: { x: 0, y: 0 }, posts: { x: 400, y: 100 } };

test('one ref-line per resolvable ref', () => {
  const schema = parseSchema(SAAS);
  const svg = renderSvg(schema, {}, {});
  assert.ok(schema.refs.length > 0);
  assert.equal((svg.match(/<path class="ss-ref-line"/g) || []).length, schema.refs.length);
  assertBalanced(svg);
});

test('edge geometry matches the editor', () => {
  const schema = parseSchema(PAIR);
  const svg = renderSvg(schema, PAIR_POS, {});
  const wUsers = measureTable(schema.tables[0]).w;
  // ref: posts.user_id (from, row 1) > users.id (to, row 0); from.x 400 > to.x 0
  // so fromOnRight=false: p1 = posts left edge, p2 = users right edge.
  const p1 = { x: 400, y: 100 + 32 + 26 + 13 };
  const p2 = { x: wUsers, y: 0 + 32 + 13 };
  const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
  const d = `M ${p1.x},${p1.y} C ${p1.x - dx},${p1.y} ${p2.x + dx},${p2.y} ${p2.x},${p2.y}`;
  assert.ok(svg.includes(`d="${d}"`), d);
  // The other orientation: from on the left.
  const flipped = renderSvg(parseSchema(PAIR), { users: { x: 500, y: 0 }, posts: { x: 0, y: 0 } }, {});
  const wPosts = measureTable(schema.tables[1]).w;
  const q1 = { x: wPosts, y: 32 + 26 + 13 };
  const q2 = { x: 500, y: 32 + 13 };
  const dq = Math.max(40, Math.abs(q2.x - q1.x) / 2);
  assert.ok(flipped.includes(`d="M ${q1.x},${q1.y} C ${q1.x + dq},${q1.y} ${q2.x - dq},${q2.y} ${q2.x},${q2.y}"`));
});

test('markers follow cardinality and are defined once with ss- ids', () => {
  const mk = (rel) => renderSvg(parseSchema(`Table a { id int }\nTable b { id int }\nRef: a.id ${rel} b.id`), {}, {});
  const many = mk('>');
  assert.ok(many.includes('marker-end="url(#ss-crow-many)"'));
  assert.ok(many.includes('marker-start="url(#ss-one-tick)"'));
  const both = mk('<>');
  assert.ok(both.includes('marker-end="url(#ss-crow-many)"'));
  assert.ok(both.includes('marker-start="url(#ss-crow-many)"'));
  const one = mk('-');
  assert.ok(one.includes('marker-end="url(#ss-one-tick)"'));
  assert.equal((both.match(/<marker /g) || []).length, 2);
  assert.equal((both.match(/id="ss-crow-many"/g) || []).length, 1);
  assert.ok(!/id="(crow-many|one-tick)"/.test(both));
  assertBalanced(both);
});

test('refs between schema-qualified tables are drawn', () => {
  const schema = parseSchema('Table public.users {\n  id int [pk]\n}\nTable billing.invoices {\n  id int [pk]\n  user_id int [ref: > public.users.id]\n}');
  const svg = renderSvg(schema, {}, {});
  assert.equal((svg.match(/<path class="ss-ref-line"/g) || []).length, 1);
});

test('named refs are drawn', () => {
  const schema = parseSchema('Table a {\n  id int [pk]\n}\nTable b {\n  a_id int\n}\nRef fk_b_a: b.a_id > a.id');
  const svg = renderSvg(schema, {}, {});
  assert.equal((svg.match(/<path class="ss-ref-line"/g) || []).length, 1);
});

test('stale refs are skipped without throwing', () => {
  const schema = parseSchema(PAIR);
  schema.refs.push(
    { fromTable: 'ghost', fromColumn: 'id', toTable: 'users', toColumn: 'id', type: '>' },
    { fromTable: 'posts', fromColumn: 'user_id', toTable: 'users', toColumn: 'nope', type: '>' },
  );
  let svg;
  assert.doesNotThrow(() => { svg = renderSvg(schema, PAIR_POS, {}); });
  assert.equal((svg.match(/class="ss-ref-line"/g) || []).length, 1);
});

test('table groups draw an area with an escaped label', () => {
  const schema = parseSchema(`Table a { id int }\nTable b { id int }\nTable c { id int }
TableGroup "Core <&>" [color: #ff0000] {\n a\n b\n missing\n}`);
  const pos = { a: { x: 100, y: 100 }, b: { x: 400, y: 200 }, c: { x: 900, y: 900 } };
  const svg = renderSvg(schema, pos, {});
  const wb = measureTable(schema.tables[1]);
  const x = 100 - 28, y = 100 - 28 - 26;
  const w = 400 + wb.w - 100 + 56, h = 200 + wb.h - 100 + 56 + 26;
  assert.ok(svg.includes(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" class="ss-area-rect" fill="#ff0000" fill-opacity="0.12" stroke="#ff0000"/>`), svg.match(/<g class="ss-area"[^]*?<\/g>/)?.[0]);
  assert.ok(svg.includes('Core &lt;&amp;&gt;</text>'));
  assert.ok(svg.indexOf('class="ss-area"') < svg.indexOf('<g class="ss-table"'));
  assertBalanced(svg);
});

test('themes: auto, light, dark', () => {
  const schema = () => parseSchema('Table a [headercolor: #ff0000] { id int }');
  const auto = renderSvg(schema(), {}, {});
  const autoExplicit = renderSvg(schema(), {}, { theme: 'auto' });
  const light = renderSvg(schema(), {}, { theme: 'light' });
  const dark = renderSvg(schema(), {}, { theme: 'dark' });
  assert.equal(auto, autoExplicit);
  assert.ok(auto.includes('@media (prefers-color-scheme: dark)'));
  assert.ok(!light.includes('prefers-color-scheme'));
  assert.ok(!dark.includes('prefers-color-scheme'));
  assert.notEqual(light, dark);
  assert.ok(light.includes('#fbfbfe') && !dark.includes('#fbfbfe'));
  for (const s of [auto, light, dark]) {
    assert.ok(s.includes('fill="#ff0000"'));
    assertBalanced(s);
    assert.ok(s.includes('font-family="system-ui'));
  }
  assert.equal(renderSvg(schema(), {}, { theme: 'bogus' }), auto);
  assert.ok(messageSvg('x').includes('<title>'));
});

test('marker strokes use the same colour as the edge line in every theme', () => {
  const src = 'Table a { id int }\nTable b { id int }\nRef: a.id > b.id';
  const stroke = (css, sel) => {
    const m = css.match(new RegExp(`\\.${sel}\\{[^}]*?stroke:(#[0-9a-f]{6})`, 'i'));
    assert.ok(m, `${sel} rule in ${css}`);
    return m[1];
  };
  const styleOf = (svg) => svg.match(/<style>([^]*?)<\/style>/)[1];
  const light = styleOf(renderSvg(parseSchema(src), {}, { theme: 'light' }));
  const dark = styleOf(renderSvg(parseSchema(src), {}, { theme: 'dark' }));
  const auto = styleOf(renderSvg(parseSchema(src), {}, { theme: 'auto' }));
  assert.equal(stroke(light, 'ss-mk'), stroke(light, 'ss-ref-line'));
  assert.equal(stroke(dark, 'ss-mk'), stroke(dark, 'ss-ref-line'));
  assert.equal(stroke(light, 'ss-mk'), '#9aa0b4');
  assert.notEqual(stroke(dark, 'ss-mk'), '#9aa0b4');
  const [autoLight, autoDark] = auto.split('@media (prefers-color-scheme: dark)');
  assert.equal(stroke(autoLight, 'ss-mk'), stroke(autoLight, 'ss-ref-line'));
  assert.equal(stroke(autoDark, 'ss-mk'), stroke(autoDark, 'ss-ref-line'));
  assert.equal(stroke(autoDark, 'ss-mk'), stroke(dark, 'ss-mk'));
  const svg = renderSvg(parseSchema(src), {}, {});
  assert.equal((svg.match(/<path class="ss-mk"/g) || []).length, 2);
});
