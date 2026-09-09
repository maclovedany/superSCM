import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellCss = readFileSync(new URL('../styles/shell.css', import.meta.url), 'utf8');

test('shell stylesheet keeps the required application layout selectors', () => {
  for (const selector of ['.app-shell', '.sidebar', '.topbar', '.content', '.nav-button']) {
    assert.match(shellCss, new RegExp(`\\${selector}\\s*\\{`), `${selector} 규칙이 styles/shell.css에 있어야 합니다.`);
  }
});

test('shell stylesheet includes a mobile layout fallback', () => {
  assert.match(shellCss, /@media\s*\(max-width:\s*760px\)/);
});

