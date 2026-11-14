const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { isAllowedNavigation } = require('./navigation.cjs');

const built = path.resolve('/tmp', 'BOLT AI', 'dist', 'index.html');
const dev = 'http://127.0.0.1:5173/';

test('accepts exact development origin only in development mode', () => {
  assert.equal(isAllowedNavigation(dev, true, dev, built), true);
  assert.equal(isAllowedNavigation('https://example.com/', true, dev, built), false);
  assert.equal(isAllowedNavigation('http://127.0.0.1:5173/other', true, dev, built), false);
  assert.equal(isAllowedNavigation('http://localhost:5173/', true, dev, built), false);
});

test('uses safe percent-encoded file URL for packaged desktop', () => {
  const productionUrl = pathToFileURL(built).href;
  assert.match(productionUrl, /BOLT%20AI/);
  assert.equal(isAllowedNavigation(productionUrl, false, dev, built), true);
  assert.equal(isAllowedNavigation('file:///etc/passwd', false, dev, built), false);
  assert.equal(isAllowedNavigation(dev, false, dev, built), false);
  assert.equal(isAllowedNavigation(productionUrl + '#other', false, dev, built), false);
});

test('does not accept non-string or empty navigation targets', () => {
  assert.equal(isAllowedNavigation('', false, dev, built), false);
  assert.equal(isAllowedNavigation(undefined, false, dev, built), false);
});
