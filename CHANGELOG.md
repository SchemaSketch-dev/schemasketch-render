# Changelog

`schemasketch-render`, the SchemaSketch SVG renderer. Versions follow
[Semantic Versioning](https://semver.org).

## 1.0.1 (2026-11-17)

- The public repository now runs the full test suite: the renderer's own tests (with the
  sample schemas they draw) and new parser tests, on Node 18, 22 and 24. They ship on
  GitHub, not in the npm package.
- README badges: version, tests, downloads, Node, dependencies, license, service status.
- No change to the rendered output.

## 1.0.0 (2026-11-17)

- First release: `renderSvg`, `renderSvgFromDbml`, `layout`, `measureTable`, `esc` and
  `RENDERER_VERSION`. Draws tables, relationships and table groups as a standalone SVG,
  in light, dark or automatic colours.
