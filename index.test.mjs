import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as api from './index.js';
import { RENDERER_VERSION } from './svg-render.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

test('renderSvgFromDbml returns svg for valid DBML and errors for invalid', () => {
  const ok = api.renderSvgFromDbml('Table users {\n  id int [pk]\n  name varchar\n}');
  assert.deepEqual(ok.errors, []);
  assert.match(ok.svg, /^<svg[\s>]/);
  assert.match(ok.svg, /users/);

  const bad = api.renderSvgFromDbml('Table users {\n  id int [pk\n');
  assert.ok(bad.errors.length > 0);
  assert.equal(typeof bad.svg, 'string');
});

test('package version equals RENDERER_VERSION', () => {
  assert.equal(pkg.version, RENDERER_VERSION);
});

test('index.js exports the documented names', () => {
  for (const name of ['renderSvg', 'renderSvgFromDbml', 'layout', 'measureTable', 'esc', 'RENDERER_VERSION']) {
    assert.ok(name in api, `missing export ${name}`);
  }
  assert.equal(typeof api.renderSvg, 'function');
  assert.equal(api.RENDERER_VERSION, RENDERER_VERSION);
});
