import { renderSvg } from './svg-render.js';
import { parseSchema } from './parser.js';

export { renderSvg, layout, measureTable, esc, RENDERER_VERSION } from './svg-render.js';

// Parses DBML and draws it. Parse errors come back in `errors`; whatever parsed
// is still drawn, so a half-written schema gives a partial picture, not nothing.
export function renderSvgFromDbml(dbml, positions = {}, options = {}) {
  const schema = parseSchema(String(dbml ?? ''));
  return { svg: renderSvg(schema, positions, options), errors: schema.errors ?? [] };
}
