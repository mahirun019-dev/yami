import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/watch/WatchUI.tsx', import.meta.url), 'utf8');
test('official notifications reuse the existing avatar with explicit type detection', () => {
  assert.match(source, /productUpdate = item.type === 'product-update'/);
  assert.match(source, /<YamiBrandAvatar alt="" \/>/);
  assert.match(source, /!item.read && <span className="notification-page-dot"/);
});
test('avatar and long-title corrections only apply to desktop product rows', () => {
  let count = 0;
  css.walkRules((rule) => {
    if (!rule.selector.startsWith('.notification-page .has-product-brand ')) return;
    assert.equal(rule.parent.type, 'atrule');
    assert.equal((rule.parent as postcss.AtRule).params, '(min-width: 768px)');
    assert.ok(!rule.selector.includes('is-read'));
    count++;
  });
  assert.equal(count, 4);
});
test('desktop avatar retains its aspect ratio without a crop', () => {
  const values: Record<string, string> = {};
  css.walkRules('.notification-page .has-product-brand .yami-brand-avatar', (rule) => {
    rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
  });
  assert.equal(values.width, '42px');
  assert.equal(values.height, '42px');
  assert.equal(values['object-fit'], 'contain');
  assert.equal(values['border-radius'], '0');
});
