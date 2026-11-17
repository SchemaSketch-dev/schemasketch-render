# schemasketch-render

[![Latest version](https://img.shields.io/npm/v/schemasketch-render?label=version)](https://www.npmjs.com/package/schemasketch-render)
[![Tests](https://github.com/SchemaSketch-dev/schemasketch-render/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/SchemaSketch-dev/schemasketch-render/actions/workflows/check.yml)
[![Downloads](https://img.shields.io/npm/dm/schemasketch-render)](https://www.npmjs.com/package/schemasketch-render)
[![Node](https://img.shields.io/node/v/schemasketch-render)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![License](https://img.shields.io/npm/l/schemasketch-render)](LICENSE)
[![SchemaSketch status](https://img.shields.io/endpoint?url=https%3A%2F%2Fstatus.schemasketch.dev%2Fbadge.json)](https://status.schemasketch.dev)

Turn a database schema into a standalone SVG image. Give it DBML (or an already parsed
schema) and get back SVG text: tables, columns, keys, relationship lines and table
groups. It's the same drawing that [SchemaSketch](https://schemasketch.dev) serves for
shared diagrams.

No dependencies, no browser, no DOM. Needs Node 18 or newer.

```sh
npm install schemasketch-render
```

## Show your schema in a GitHub README

GitHub and npm only show images, not embeds. If your diagram lives in SchemaSketch, you
don't need this package at all: open the diagram, click **Share**, set the link to
**Public**, and press **Copy Markdown** under **Show it in a GitHub README**. It stays up to date as you
edit the diagram:

```md
[![Database schema](https://schemasketch.dev/api/public/diagrams/YOUR-TOKEN/image.svg)](https://schemasketch.dev/view.html?token=YOUR-TOKEN)
```

Use this package when you'd rather generate the SVG yourself, for example in a build
step or a docs generator, and commit the file.

## Usage

```js
import { writeFileSync } from 'node:fs';
import { renderSvgFromDbml } from 'schemasketch-render';

const { svg, errors } = renderSvgFromDbml(`
  Table users {
    id int [pk, increment]
    email varchar [unique, not null]
  }

  Table posts {
    id int [pk, increment]
    user_id int [ref: > users.id]
    title varchar
  }
`, {}, { title: 'Blog schema', theme: 'light' });

if (errors.length) console.warn(errors);
writeFileSync('schema.svg', svg);
```

## API

### `renderSvgFromDbml(dbml, positions?, options?)`

Parses the DBML and draws it. Returns `{ svg, errors }`. `errors` is a list of parse
messages (empty when the DBML is valid); whatever parsed is still drawn.

### `renderSvg(schema, positions?, options?)`

Draws a schema object in the shape the parser produces
(`{ tables, refs, tableGroups, enums }`). Returns the SVG string.

### Arguments

- `positions`: `{ "table_name": { x, y } }`. Tables without a position are placed
  automatically.
- `options.title`: accessible title of the image (default `"Database diagram"`).
- `options.theme`: `"light"`, `"dark"` or `"auto"` (default; follows the viewer's
  colour scheme).

Table names and values are escaped, so the output is safe to embed from untrusted
schemas. Diagrams with no tables, or very large ones, return a small message image
instead.

### Also exported

`layout(schema, positions)`, `measureTable(table)`, `esc(value)` and `RENDERER_VERSION`.

## License

MIT. Part of [SchemaSketch](https://schemasketch.dev).
