import assert from 'node:assert/strict';
import fs from 'node:fs';

const pages = ['index.html', 'new-products.html', 'translate-descriptions.html'];

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');

  assert.match(html, /--bg:#f6f8fb/, `${page} must use the light background token`);
  assert.match(html, /--surface:#ffffff/, `${page} must use white surface cards`);
  assert.match(html, /body\{[^}]*#ffffff 0,#f6f8fb 280px/, `${page} body must use the light page gradient`);
  assert.doesNotMatch(html, /body\{[^}]*#101114 0,#0b0c10 260px/, `${page} must not keep the old dark page gradient`);
  assert.doesNotMatch(html, /background:#0f1117/, `${page} must not keep dark input/log backgrounds`);
  assert.doesNotMatch(html, /th\{background:#1b1f29/, `${page} must not keep dark table headers`);
}
