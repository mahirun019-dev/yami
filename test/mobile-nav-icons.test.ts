import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
test('mobile uses the same native regular/fill family without changing desktop icons', () => {
  const mobile = app.slice(app.indexOf('function MobileNav({'), app.indexOf('function Title({'));
  assert.equal((mobile.match(/<MobileNavIcon /g) || []).length, 5);
  assert.doesNotMatch(mobile, /<SidebarNavIcon/);
  assert.match(app, /function MobileNavIcon[\s\S]*?const Icon = sidebarIcons\[view\]/);
  assert.match(app, /size=\{24\}[\s\S]*?weight=\{active \? "fill" : "regular"\}/);
});
test('optical sizing has a shared fixed frame and no transform or position correction', () => {
  const rules = css.slice(css.indexOf('  .career-mobile-nav .mobile-nav-icon {'), css.indexOf('@media (min-width: 761px)', css.indexOf('  .career-mobile-nav .mobile-nav-icon {')));
  assert.match(rules, /width: 28px;\s+height: 28px;/);
  assert.match(rules, /place-items: center/);
  assert.match(rules, /--mobile-glyph-size: 24.5px/);
  assert.match(rules, /--mobile-glyph-size: 25px/);
  assert.doesNotMatch(rules, /transform:|margin:|stroke-width:/);
});
