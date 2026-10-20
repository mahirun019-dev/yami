import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from '@babel/parser';

const source = readFileSync(new URL('../src/about/AboutSettings.tsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
function visit(node: any, callback: (node: any) => void) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback));
    else if (value && typeof value === 'object') visit(value, callback);
  }
}
let overview: any;
visit(ast, (node) => {
  if (node.type === 'ConditionalExpression' && node.test.left?.name === 'panel' && node.test.right?.value === 'overview') overview = node.consequent;
});
const overviewMarkup = () => source.slice(overview.start, overview.end);

test('About overview retains the existing brand without a tagline or replacement copy', () => {
  assert.ok(overview);
  const markup = overviewMarkup();
  assert.match(markup, /<YamiAboutBrand\s*\/>/);
  assert.doesNotMatch(markup, /<p\b|copy\.tagline/);
});

test('About overview has no app information, version, date, build SHA or PWA presentation', () => {
  assert.ok(overview);
  assert.doesNotMatch(overviewMarkup(), /about-info|about-build|about-pwa|copy\.(appInfo|version|latestUpdate|build|pwa)|__YAMI_BUILD__|<time\b|<details\b/);
});

test('About overview exposes only history and privacy, without a primary license row', () => {
  assert.ok(overview);
  assert.match(overviewMarkup(), /\['history', 'privacy'\]/);
  assert.doesNotMatch(overviewMarkup(), /licenses/);
  const renderedTags: string[] = [];
  visit(overview, (node) => { if (node.type === 'JSXOpeningElement') renderedTags.push(node.name.name); });
  assert.deepEqual(renderedTags, ['div', 'YamiAboutBrand', 'nav', 'button', 'span', 'strong', 'small', 'ChevronRight']);
});

test('license notices remain accessible as a secondary action within privacy', () => {
  assert.match(source, /className="about-legal-link" onClick=\{\(\) => setPanel\('licenses'\)\}/);
  assert.match(source, /__YAMI_BUILD__\.dependencies\.map/);
  assert.match(source, /panel === 'licenses' \? 'privacy' : 'overview'/);
});
