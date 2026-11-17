// DBML-like schema language parser.
// Supports:
//   Table name [as alias] { col type [settings]  ... Note: '...' }
//   Enum name { value1  value2 ... }
//   Ref: table1.col > table2.col     (also <, -, <>)
//   Ref name { table1.col > table2.col }
//   inline column ref: `ref: > other.col`
//   // line comments and /* block comments */
//   Table settings [color: #hex]  (color only, cosmetic)

// Triple-quoted strings ('''...''') can span multiple lines and contain
// anything (commas, quotes, `//`) — pull them out before any other parsing
// (including comment-stripping) so their content can't be misinterpreted,
// then swap in an ordinary single-quoted placeholder the rest of the parser
// already knows how to handle.
function extractTripleQuoted(source) {
  const store = [];
  const replaced = source.replace(/'''([\s\S]*?)'''/g, (_, content) => {
    const idx = store.length;
    store.push(content.trim());
    return `'@@TQ${idx}@@'`;
  });
  return { replaced, store };
}

function resolvePlaceholders(value, store) {
  if (typeof value !== 'string') return value;
  const m = value.match(/^@@TQ(\d+)@@$/);
  return m ? store[Number(m[1])] : value;
}

function stripComments(text) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

// Split a top-level comma list respecting (), [], '', "" nesting.
function splitTopLevel(str, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === quote && str[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function unquote(s) {
  s = s.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    const quoteChar = s[0];
    // Only the delimiter itself is ever backslash-escaped inside a DBML
    // quoted string (e.g. default: 'O\'Brien') - unescape it so the value
    // callers see is the real one, not the escape sequence.
    return s.slice(1, -1).split(`\\${quoteChar}`).join(quoteChar);
  }
  return s;
}

function parseSettingsList(str) {
  const out = {};
  const flags = [];
  for (const raw of splitTopLevel(str, ',')) {
    const m = raw.match(/^([a-zA-Z_ ]+?)\s*:\s*(.+)$/);
    if (m) {
      const key = m[1].trim().toLowerCase();
      const val = unquote(m[2]);
      out[key] = val;
    } else {
      flags.push(raw.trim().toLowerCase());
    }
  }
  out.__flags = flags;
  return out;
}

function applyColumnSettings(col, settingsStr) {
  if (!settingsStr) return;
  const parsed = parseSettingsList(settingsStr);
  for (const flag of parsed.__flags) {
    if (flag === 'pk' || flag === 'primary key') col.pk = true;
    else if (flag === 'not null') col.notNull = true;
    else if (flag === 'null') col.notNull = false;
    else if (flag === 'unique') col.unique = true;
    else if (flag === 'increment') col.increment = true;
    else if (flag.startsWith('ref:')) {
      col.inlineRef = flag.slice(4).trim();
    }
  }
  if (parsed.default !== undefined) col.default = parsed.default;
  if (parsed.note !== undefined) col.note = parsed.note;
  // handle key: value forms of ref (ref: > table.col) that split() above may have
  // captured as key "ref" value "> table.col" since it contains ':'
  for (const raw of splitTopLevel(settingsStr, ',')) {
    const m = raw.match(/^ref\s*:\s*(.+)$/i);
    if (m) col.inlineRef = m[1].trim();
  }
}

function findMatchingBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseRefEndpoint(str) {
  str = str.trim();
  // schema.table.column, table.column, or a composite table.(col1, col2).
  // The table keeps its schema ("billing.invoices"); resolveName() matches it to a declared table.
  const compMatch = str.match(/^([\w."]+)\.\(([^)]+)\)$/);
  if (compMatch) {
    const table = compMatch[1].replace(/"/g, '');
    const columns = splitTopLevel(compMatch[2], ',').map((c) => c.trim().replace(/"/g, '')).filter(Boolean);
    return { table, column: columns[0], columns };
  }
  const parts = str.split('.').map((p) => p.replace(/"/g, ''));
  const column = parts.pop();
  const table = parts.join('.');
  return { table, column, columns: [column] };
}

function normalizeRefAction(value) {
  const s = (value || '').toLowerCase().trim();
  return ['cascade', 'restrict', 'set null', 'set default', 'no action'].includes(s) ? s : null;
}

function parseRefLine(body, refs, name) {
  // body like: table1.col > table2.col   or  table1.col <> table2.col
  // optionally followed by a trailing [delete: cascade, update: restrict] settings bracket.
  let settingsStr = null;
  const bracketMatch = body.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
  if (bracketMatch) {
    body = bracketMatch[1];
    settingsStr = bracketMatch[2];
  }
  const m = body.match(/^(.+?)\s*(<>|>|<|-)\s*(.+)$/);
  if (!m) return;
  const from = parseRefEndpoint(m[1]);
  const type = m[2];
  const to = parseRefEndpoint(m[3]);
  // fromColumn/toColumn are the first column; fromColumns/toColumns list them all (composite refs).
  const ref = {
    fromTable: from.table, fromColumn: from.column, toTable: to.table, toColumn: to.column, type,
    fromColumns: from.columns, toColumns: to.columns,
  };
  if (name) ref.name = name;
  if (settingsStr) {
    const parsed = parseSettingsList(settingsStr);
    if (parsed.delete !== undefined) ref.onDelete = normalizeRefAction(parsed.delete);
    if (parsed.update !== undefined) ref.onUpdate = normalizeRefAction(parsed.update);
  }
  refs.push(ref);
}

export function parseSchema(source) {
  const { replaced, store: tqStore } = extractTripleQuoted(source || '');
  const text = stripComments(replaced);
  const tables = [];
  const enums = [];
  const refs = [];
  const tableGroups = [];
  const errors = [];
  const tableByLowerName = new Map();

  // Find all top-level keyword blocks / statements.
  const keywordRe = /\b(Table|Enum|Ref|TableGroup|Project)\b/g;
  let match;
  const consumedUntil = { pos: 0 };

  while ((match = keywordRe.exec(text)) !== null) {
    if (match.index < consumedUntil.pos) continue;
    const keyword = match[1];
    const afterKeyword = match.index + keyword.length;

    if (keyword === 'Ref') {
      // "Ref: a.b > c.d", "Ref name: a.b > c.d", "Ref name { ... }" or "Ref { ... }".
      // The name is optional, bare or "quoted", and the { must be on the Ref's own
      // line: otherwise "Ref name: ..." would reach forward into the next table.
      const lineEnd = text.indexOf('\n', afterKeyword);
      const restOfLine = text.slice(afterKeyword, lineEnd === -1 ? text.length : lineEnd);
      const NAME = '(?:"([^"]*)"|([A-Za-z_][\\w]*))';
      const colonInline = restOfLine.match(new RegExp(`^\\s*(?:${NAME}\\s*)?:\\s*(.+)$`));
      if (colonInline) {
        const name = colonInline[1] ?? colonInline[2];
        parseRefLine(colonInline[3].trim(), refs, name);
        keywordRe.lastIndex = afterKeyword + colonInline[0].length;
        continue;
      }
      const blockHead = restOfLine.match(new RegExp(`^\\s*(?:${NAME}\\s*)?\\{`));
      if (blockHead) {
        const name = blockHead[1] ?? blockHead[2];
        const braceIdx = afterKeyword + blockHead[0].length - 1;
        const closeIdx = findMatchingBrace(text, braceIdx);
        if (closeIdx === -1) {
          errors.push('Unclosed Ref block');
          break;
        }
        const inner = text.slice(braceIdx + 1, closeIdx);
        for (const line of inner.split('\n')) {
          const t = line.trim();
          if (t) parseRefLine(t, refs, name);
        }
        keywordRe.lastIndex = closeIdx + 1;
        continue;
      }
      continue;
    }

    if (keyword === 'Project') {
      const braceIdx = text.indexOf('{', afterKeyword);
      if (braceIdx !== -1) {
        const closeIdx = findMatchingBrace(text, braceIdx);
        if (closeIdx !== -1) {
          keywordRe.lastIndex = closeIdx + 1;
          continue;
        }
      }
      continue;
    }

    if (keyword === 'TableGroup') {
      // TableGroup name [color: '#hex'] { table1 \n table2 \n ... }
      // Renders as a colored bounding region around its member tables — a
      // subject area — purely organizational, no effect on the schema itself.
      const braceIdx = text.indexOf('{', afterKeyword);
      if (braceIdx === -1) { errors.push('TableGroup missing {'); continue; }
      const header = text.slice(afterKeyword, braceIdx).trim();
      let name = header;
      let color = null;
      const settingsBracket = header.match(/\[(.*)\]\s*$/);
      if (settingsBracket) {
        name = header.slice(0, settingsBracket.index).trim();
        const s = parseSettingsList(settingsBracket[1]);
        if (s.color) color = s.color;
      }
      name = name.replace(/"/g, '');

      const closeIdx = findMatchingBrace(text, braceIdx);
      if (closeIdx === -1) { errors.push(`TableGroup ${name} missing closing }`); break; }
      const inner = text.slice(braceIdx + 1, closeIdx);
      const memberTables = inner
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split('[')[0].trim().replace(/"/g, ''))
        .filter(Boolean);

      tableGroups.push({ name, color, tables: memberTables });
      keywordRe.lastIndex = closeIdx + 1;
      continue;
    }

    if (keyword === 'Enum') {
      const header = text.slice(afterKeyword, text.indexOf('{', afterKeyword));
      const name = header.trim().split(/\s+/)[0];
      const braceIdx = text.indexOf('{', afterKeyword);
      if (braceIdx === -1) { errors.push(`Enum ${name || ''} missing {`); continue; }
      const closeIdx = findMatchingBrace(text, braceIdx);
      if (closeIdx === -1) { errors.push(`Enum ${name} missing closing }`); break; }
      const inner = text.slice(braceIdx + 1, closeIdx);
      const values = inner
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split('[')[0].trim())
        .filter(Boolean);
      enums.push({ name, values });
      keywordRe.lastIndex = closeIdx + 1;
      continue;
    }

    if (keyword === 'Table') {
      const braceIdx = text.indexOf('{', afterKeyword);
      if (braceIdx === -1) { errors.push('Table missing {'); continue; }
      const header = text.slice(afterKeyword, braceIdx).trim();
      // name [as alias] [settings]
      let name = header;
      let alias = null;
      let settingsStr = null;
      const settingsBracket = header.match(/\[(.*)\]\s*$/);
      if (settingsBracket) {
        settingsStr = settingsBracket[1];
        name = header.slice(0, settingsBracket.index).trim();
      }
      const asMatch = name.match(/^(\S+)\s+as\s+(\S+)$/i);
      if (asMatch) {
        name = asMatch[1];
        alias = asMatch[2];
      }
      name = name.replace(/"/g, '');

      const closeIdx = findMatchingBrace(text, braceIdx);
      if (closeIdx === -1) { errors.push(`Table ${name} missing closing }`); break; }
      const inner = text.slice(braceIdx + 1, closeIdx);

      const table = { name, alias, columns: [], indexes: [], note: null, color: null };
      if (settingsStr) {
        const s = parseSettingsList(settingsStr);
        if (s.headercolor) table.color = s.headercolor;
        if (s.color) table.color = s.color;
      }

      // Walk inner line by line, but respect bracket settings that might span... generally one line per column.
      const lines = inner.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li].trim();
        if (!line) continue;
        if (/^Note\s*:/i.test(line)) {
          const nm = line.match(/^Note\s*:\s*(.+)$/i);
          if (nm) table.note = unquote(nm[1].trim());
          continue;
        }
        if (/^Indexes\s*\{?/i.test(line)) {
          // Entries look like "(a, b) [unique]", "col [name: 'foo']", or a
          // bare "col" for a plain single-column index. Composite entries
          // would otherwise fall through to the column-line parsing below
          // and get misread as a bogus column named "(a,", so this block is
          // consumed and parsed on its own rather than left to that path.
          li++;
          while (li < lines.length && lines[li].trim() !== '}') {
            const idxLine = lines[li].trim();
            if (idxLine) {
              const bracketMatch = idxLine.match(/^(.*?)\[(.*)\]\s*$/);
              const head = bracketMatch ? bracketMatch[1].trim() : idxLine;
              const settingsStr = bracketMatch ? bracketMatch[2] : null;
              const compMatch = head.match(/^\(([^)]+)\)$/);
              const columns = compMatch
                ? splitTopLevel(compMatch[1], ',').map((c) => c.replace(/"/g, '').trim())
                : [head.replace(/"/g, '').trim()];
              if (columns.length && columns[0]) {
                const entry = { columns, unique: false, pk: false, name: null };
                if (settingsStr) {
                  const parsedIdx = parseSettingsList(settingsStr);
                  for (const flag of parsedIdx.__flags) {
                    if (flag === 'unique') entry.unique = true;
                    else if (flag === 'pk' || flag === 'primary key') entry.pk = true;
                  }
                  if (parsedIdx.name !== undefined) entry.name = parsedIdx.name;
                }
                table.indexes.push(entry);
              }
            }
            li++;
          }
          continue;
        }
        // column line: name type [settings]
        const bracketMatch = line.match(/^(.*?)\[(.*)\]\s*$/);
        let head = line;
        let settings = null;
        if (bracketMatch) {
          head = bracketMatch[1].trim();
          settings = bracketMatch[2];
        }
        const headParts = head.match(/^("[^"]+"|\S+)\s+([\s\S]+)$/);
        if (!headParts) continue;
        const colName = headParts[1].replace(/"/g, '');
        // A native passthrough type ("bigint unsigned", "enum('a','b')") is
        // wrapped in double quotes only because it contains whitespace/a
        // comma/a quote - unquote() strips that DBML-level delimiter so the
        // stored type is the real one (e.g. exporting it back to SQL), not
        // a type name with literal quote characters baked into it.
        const colType = unquote(headParts[2].trim());
        const col = {
          name: colName,
          type: colType,
          pk: false,
          notNull: false,
          unique: false,
          increment: false,
          default: null,
          note: null,
          inlineRef: null,
        };
        applyColumnSettings(col, settings);
        table.columns.push(col);
      }

      tables.push(table);
      tableByLowerName.set(name.toLowerCase(), table);
      if (alias) tableByLowerName.set(alias.toLowerCase(), table);
      keywordRe.lastIndex = closeIdx + 1;
      continue;
    }
  }

  // Resolve inline column refs (col [ref: > other.col]) into the refs array.
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.inlineRef) {
        const m = col.inlineRef.match(/^(<>|>|<|-)\s*(.+)$/);
        if (m) {
          const to = parseRefEndpoint(m[2]);
          refs.push({
            fromTable: table.name, fromColumn: col.name, toTable: to.table, toColumn: to.column, type: m[1],
            fromColumns: [col.name], toColumns: to.columns,
          });
        }
      }
    }
  }

  // Normalize ref table names against actual table names/aliases (case-insensitive).
  // "public" is the default schema, so "users" and "public.users" name the same table.
  function resolveName(n) {
    const key = (n || '').toLowerCase();
    const t = tableByLowerName.get(key)
      || (key.startsWith('public.') ? tableByLowerName.get(key.slice(7)) : tableByLowerName.get(`public.${key}`));
    return t ? t.name : n;
  }
  for (const ref of refs) {
    ref.fromTable = resolveName(ref.fromTable);
    ref.toTable = resolveName(ref.toTable);
  }
  for (const group of tableGroups) {
    group.tables = group.tables.map(resolveName);
  }

  // Swap triple-quoted placeholders back to their real (possibly multi-line) text.
  for (const table of tables) {
    table.note = resolvePlaceholders(table.note, tqStore);
    for (const col of table.columns) {
      col.note = resolvePlaceholders(col.note, tqStore);
      col.default = resolvePlaceholders(col.default, tqStore);
    }
  }

  return { tables, enums, refs, tableGroups, errors };
}
