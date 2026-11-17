// Standalone SVG renderer: turns a parsed schema (parseSchema()) plus stored
// table positions into an SVG string. Pure: no DOM, no browser APIs, so it
// runs in Node 18+ and in browsers.
//
// The output is served from the app's own domain and the diagram content is
// untrusted, so every text and attribute value goes through esc(), colours
// are validated, positions are coerced to finite numbers, and no user value
// is ever used as an element/attribute name, style text, href or url().
//
// Drawing constants mirror frontend/renderer.js (the interactive editor).

export const RENDERER_VERSION = '1.0.4';

const ROW_H = 26;
const HEADER_H = 32;
const CHAR_W = 7.2;
const BOLD_EXTRA = 1.2;
const PAD_X = 14;
const MIN_TABLE_W = 160;
const TABLE_GAP_X = 90;
const TABLE_GAP_Y = 70;
const DEFAULT_HEADER_COLOR = '#5b6cf0';
// Table header presets, as in the editor.
export const PRESET_COLORS = [
  '#5b6cf0', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16',
  '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b',
];
const BADGE_W = 20;
const BADGE_H = 14;
const BADGE_GAP = 3;
const BADGE_DEFS = {
  pk: { label: 'PK', color: '#5b6cf0' },
  increment: { label: 'AI', color: '#06b6d4' },
  unique: { label: 'UQ', color: '#a855f7' },
  notNull: { label: 'NN', color: '#f97316' },
};
const EXPORT_PAD = 30;
const AREA_PAD = 28;
const AREA_LABEL_H = 26;
const DEFAULT_AREA_COLOR = '#64748b';
const EDGE_COLOR = '#9aa0b4';
// Themed colours. Light matches the editor's export; dark follows its dark
// tokens. User-chosen header and group colours are never themed.
const PALETTES = {
  light: {
    bg: '#fbfbfe', card: '#ffffff', cardStroke: '#d9dce9', sep: '#eceef6', text: '#1f2330',
    pk: '#4350c8', type: '#8b90a5', edge: EDGE_COLOR, msg: '#4a4f66', msgStroke: '#e1e3ee',
  },
  dark: {
    bg: '#16171d', card: '#1f212b', cardStroke: '#343746', sep: '#2b2e3b', text: '#e6e8f0',
    pk: '#a5b0ff', type: '#8f94aa', edge: '#6b7088', msg: '#c4c8d8', msgStroke: '#343746',
  },
};
const MAX_TABLES = 300;
const COORD_LIMIT = 100000;
const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const HEADER_ICONS_W = 74;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const COLOR_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

// The single escaping point for text and attribute values.
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    // Control characters are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // Defence in depth: numeric references render identically, but keep
    // attribute-looking and URL-looking text from appearing in the output.
    .replace(/=/g, '&#61;')
    .replace(/(url)\(/gi, '$1&#40;')
    .replace(/(javascript):/gi, '$1&#58;');
}

function safeColor(value, fallback = DEFAULT_HEADER_COLOR) {
  return typeof value === 'string' && COLOR_RE.test(value.trim()) ? value.trim() : fallback;
}

function num(n) {
  return Math.round(n * 100) / 100;
}

function textWidth(str, bold = false) {
  return str.length * CHAR_W + (bold ? str.length * BOLD_EXTRA : 0);
}

function truncateDefault(value) {
  const s = String(value);
  return s.length > 12 ? s.slice(0, 12) + '…' : s;
}

function hasDefault(col) {
  return col.default !== undefined && col.default !== null && col.default !== '';
}

function badgeList(col) {
  const badges = [];
  if (col.pk) badges.push(BADGE_DEFS.pk);
  if (col.increment) badges.push(BADGE_DEFS.increment);
  if (col.unique) badges.push(BADGE_DEFS.unique);
  if (col.notNull) badges.push(BADGE_DEFS.notNull);
  return badges;
}

export function measureTable(table) {
  const columns = table.columns || [];
  let w = Math.max(MIN_TABLE_W, textWidth(String(table.name), true) + PAD_X * 2 + HEADER_ICONS_W);
  for (const col of columns) {
    const badgeCount = badgeList(col).length;
    const badgesW = badgeCount ? badgeCount * BADGE_W + (badgeCount - 1) * BADGE_GAP + 8 : 0;
    const defaultW = hasDefault(col) ? textWidth(' = ' + truncateDefault(col.default)) : 0;
    const label = String(col.name) + '   ' + String(col.type);
    w = Math.max(w, textWidth(label) + defaultW + badgesW + PAD_X * 2 + 54);
  }
  return { w: Math.round(w), h: HEADER_H + columns.length * ROW_H };
}

function coerceCoord(v) {
  if (typeof v === 'string' && v.trim() === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT ? n : null;
}

// Returns a new { [tableName]: {x, y} } with every table placed. Positions
// that are missing or not usable count as unplaced. Port of the editor's
// _ensureLayout, starting from the coerced copy.
export function layout(schema, positions) {
  const tables = schema.tables || [];
  const src = positions && typeof positions === 'object' ? positions : {};
  const out = Object.create(null);
  for (const t of tables) {
    if (!Object.prototype.hasOwnProperty.call(src, t.name)) continue;
    const p = src[t.name];
    if (!p || typeof p !== 'object') continue;
    const x = coerceCoord(p.x);
    const y = coerceCoord(p.y);
    if (x === null || y === null) continue;
    out[t.name] = { x, y };
  }

  const unpositioned = tables.filter((t) => !out[t.name]);
  if (unpositioned.length === 0) return out;

  let startY = 40;
  for (const t of tables) {
    const pos = out[t.name];
    if (!pos) continue;
    startY = Math.max(startY, pos.y + measureTable(t).h + TABLE_GAP_Y);
  }

  const cols = Math.max(1, Math.ceil(Math.sqrt(unpositioned.length)));
  let x = 40;
  let y = startY;
  let rowMaxH = 0;
  let i = 0;
  for (const t of unpositioned) {
    const { w, h } = measureTable(t);
    out[t.name] = { x, y };
    rowMaxH = Math.max(rowMaxH, h);
    x += w + TABLE_GAP_X;
    i++;
    if (i % cols === 0) {
      x = 40;
      y += rowMaxH + TABLE_GAP_Y;
      rowMaxH = 0;
    }
  }
  return out;
}

function paletteRules(p) {
  return `.ss-bg{fill:${p.bg}}.ss-card{fill:${p.card};stroke:${p.cardStroke}}.ss-sep{stroke:${p.sep}}`
    + `.ss-tx{fill:${p.text}}.ss-pk{fill:${p.pk}}.ss-ty{fill:${p.type}}`
    + `.ss-ref-line{fill:none;stroke:${p.edge};stroke-width:1.4}.ss-mk{stroke:${p.edge}}`
    + `.ss-msg-card{fill:${p.card};stroke:${p.msgStroke}}.ss-msg{fill:${p.msg}}`;
}

function themeStyle(theme) {
  if (theme === 'dark') return `<style>${paletteRules(PALETTES.dark)}</style>`;
  if (theme === 'light') return `<style>${paletteRules(PALETTES.light)}</style>`;
  return `<style>${paletteRules(PALETTES.light)}@media (prefers-color-scheme: dark){${paletteRules(PALETTES.dark)}}</style>`;
}

function normTheme(theme) {
  return theme === 'light' || theme === 'dark' ? theme : 'auto';
}

// The one place that writes the root <svg>, <title>, theme <style> and
// background. `vb` is {x, y, w, h}.
function svgOpen(vb, title, theme) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.w)} ${num(vb.h)}" width="${num(vb.w)}" height="${num(vb.h)}" font-family="${esc(FONT)}">`
    + `<title>${esc(title)}</title>`
    + themeStyle(normTheme(theme))
    + `<rect class="ss-bg" x="${num(vb.x)}" y="${num(vb.y)}" width="${num(vb.w)}" height="${num(vb.h)}"/>`;
}

// Small standalone card, also used for the "too large" / "can't show" fallbacks.
export function messageSvg(text, theme) {
  const w = 400;
  const h = 120;
  return svgOpen({ x: 0, y: 0, w, h }, text, theme)
    + `<rect class="ss-msg-card" x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8"/>`
    + `<text class="ss-msg" x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" font-size="14">${esc(text)}</text>`
    + '</svg>';
}

function renderRow(col, y, w) {
  const center = y + ROW_H / 2;
  const badges = badgeList(col);
  const clusterW = badges.length ? badges.length * BADGE_W + (badges.length - 1) * BADGE_GAP : 0;
  const clusterLeft = (w - PAD_X - 4) - clusterW;
  const typeRight = badges.length ? clusterLeft - 8 : w - PAD_X - 16;

  let s = '<g class="ss-row">';
  s += `<line class="ss-sep" x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  s += `<text class="${col.pk ? 'ss-pk' : 'ss-tx'}" x="${PAD_X}" y="${center + 4}" font-family="${esc(MONO)}" font-size="12"${col.pk ? ' font-weight="700"' : ''}>${esc(col.name)}</text>`;
  s += `<text class="ss-ty" x="${num(typeRight)}" y="${center + 4}" text-anchor="end" font-family="${esc(MONO)}" font-size="11">${esc(col.type)}`;
  if (hasDefault(col)) s += `<tspan font-style="italic" opacity="0.8">${esc(' = ' + truncateDefault(col.default))}</tspan>`;
  s += '</text>';
  badges.forEach((def, i) => {
    const bx = clusterLeft + i * (BADGE_W + BADGE_GAP);
    s += `<rect x="${num(bx)}" y="${num(center - BADGE_H / 2)}" width="${BADGE_W}" height="${BADGE_H}" rx="3" fill="${def.color}"/>`;
    s += `<text x="${num(bx + BADGE_W / 2)}" y="${center + 3}" text-anchor="middle" font-family="${esc(MONO)}" font-size="8.5" font-weight="800" letter-spacing="0.2" fill="#ffffff">${def.label}</text>`;
  });
  return s + '</g>';
}

function renderTable(table, pos, size) {
  const { w, h } = size;
  const color = safeColor(table.color);
  let s = `<g class="ss-table" transform="translate(${num(pos.x)} ${num(pos.y)})">`;
  s += `<rect class="ss-card" width="${w}" height="${h}" rx="8"/>`;
  s += `<path d="M0 ${HEADER_H} V8 a8 8 0 0 1 8 -8 H${w - 8} a8 8 0 0 1 8 8 V${HEADER_H} Z" fill="${color}"/>`;
  s += `<text x="${PAD_X}" y="${HEADER_H / 2 + 5}" font-size="13" font-weight="700" fill="#ffffff">${esc(table.name)}</text>`;
  (table.columns || []).forEach((col, i) => {
    s += renderRow(col, HEADER_H + i * ROW_H, w);
  });
  return s + '</g>';
}

function renderTables(schema, positions, sizes) {
  return schema.tables.map((t) => renderTable(t, positions[t.name], sizes.get(t))).join('');
}

// Row centre of a column; a missing table or column means a stale ref (null).
function colRowCenter(tableByName, positions, sizes, tableName, colName) {
  const table = tableByName.get(tableName);
  const pos = positions[tableName];
  if (!table || !pos) return null;
  const idx = (table.columns || []).findIndex((c) => c.name === colName);
  if (idx === -1) return null;
  const { w } = sizes.get(table);
  return { x: pos.x, y: pos.y + HEADER_H + idx * ROW_H + ROW_H / 2, xRight: pos.x + w };
}

function renderEdges(schema, positions, sizes) {
  const tableByName = new Map();
  for (const t of schema.tables) if (!tableByName.has(t.name)) tableByName.set(t.name, t);
  let s = '';
  for (const ref of schema.refs || []) {
    if (!ref) continue;
    const from = colRowCenter(tableByName, positions, sizes, ref.fromTable, ref.fromColumn);
    const to = colRowCenter(tableByName, positions, sizes, ref.toTable, ref.toColumn);
    if (!from || !to) continue;
    const fromOnRight = from.x < to.x;
    const p1 = { x: fromOnRight ? from.xRight : from.x, y: from.y };
    const p2 = { x: fromOnRight ? to.x : to.xRight, y: to.y };
    const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
    const c1x = p1.x + (fromOnRight ? dx : -dx);
    const c2x = p2.x + (fromOnRight ? -dx : dx);
    const d = `M ${num(p1.x)},${num(p1.y)} C ${num(c1x)},${num(p1.y)} ${num(c2x)},${num(p2.y)} ${num(p2.x)},${num(p2.y)}`;
    const isMany = ref.type === '>' || ref.type === '<>';
    const otherMany = ref.type === '<' || ref.type === '<>';
    s += `<path class="ss-ref-line" d="${d}" marker-start="url(#ss-${otherMany ? 'crow-many' : 'one-tick'})" marker-end="url(#ss-${isMany ? 'crow-many' : 'one-tick'})"/>`;
  }
  return s;
}

const MARKER_DEFS = '<defs>'
  + `<marker id="ss-crow-many" markerWidth="14" markerHeight="14" refX="10" refY="6" orient="auto"><path class="ss-mk" d="M0,0 L10,6 L0,12 M0,6 L10,6" fill="none" stroke="${EDGE_COLOR}" stroke-width="1.4"/></marker>`
  + `<marker id="ss-one-tick" markerWidth="12" markerHeight="12" refX="8" refY="6" orient="auto"><path class="ss-mk" d="M8,0 L8,12 M4,0 L4,12" stroke="${EDGE_COLOR}" stroke-width="1.4"/></marker>`
  + '</defs>';

// Returns { svg, rects } for the table-group areas. Members that are
// missing from the schema are ignored; a group with no members is skipped.
function renderAreas(schema, positions, sizes) {
  const tableByName = new Map();
  for (const t of schema.tables) if (!tableByName.has(t.name)) tableByName.set(t.name, t);
  let s = '';
  const rects = [];
  for (const group of schema.tableGroups || []) {
    if (!group || !Array.isArray(group.tables)) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const name of group.tables) {
      const pos = positions[name];
      const table = tableByName.get(name);
      if (!pos || !table) continue;
      const { w, h } = sizes.get(table);
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + w);
      maxY = Math.max(maxY, pos.y + h);
    }
    if (minX === Infinity) continue;
    const x = minX - AREA_PAD;
    const y = minY - AREA_PAD - AREA_LABEL_H;
    const w = (maxX - minX) + AREA_PAD * 2;
    const h = (maxY - minY) + AREA_PAD * 2 + AREA_LABEL_H;
    const color = safeColor(group.color, DEFAULT_AREA_COLOR);
    rects.push({ x, y, w, h });
    s += '<g class="ss-area">'
      + `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="12" class="ss-area-rect" fill="${color}" fill-opacity="0.12" stroke="${color}"/>`
      + `<text x="${num(x + 14)}" y="${num(y + AREA_LABEL_H / 2 + 5)}" font-size="12.5" font-weight="800" fill="${color}">${esc(group.name)}</text>`
      + '</g>';
  }
  return { svg: s, rects };
}

export function renderSvg(schema, positions = {}, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const title = opts.title ? String(opts.title) : 'Database diagram';
  const theme = normTheme(opts.theme);
  const tables = schema && Array.isArray(schema.tables) ? schema.tables : [];
  if (tables.length === 0) return messageSvg('Empty diagram', theme);
  if (tables.length > MAX_TABLES) return messageSvg('Diagram too large to preview, open it in SchemaSketch', theme);

  const full = { tables, refs: schema.refs, tableGroups: schema.tableGroups };
  const pos = layout(full, positions);
  const sizes = new Map(tables.map((t) => [t, measureTable(t)]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tables) {
    const p = pos[t.name];
    const { w, h } = sizes.get(t);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + w);
    maxY = Math.max(maxY, p.y + h);
  }
  const areas = renderAreas(full, pos, sizes);
  for (const r of areas.rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const vb = { x: minX - EXPORT_PAD, y: minY - EXPORT_PAD, w: maxX - minX + EXPORT_PAD * 2, h: maxY - minY + EXPORT_PAD * 2 };

  const edges = renderEdges(full, pos, sizes);
  return svgOpen(vb, title, theme)
    + (edges ? MARKER_DEFS : '')
    + areas.svg
    + edges
    + renderTables(full, pos, sizes)
    + '</svg>';
}
