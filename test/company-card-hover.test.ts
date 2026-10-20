import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
import { PRODUCT_UPDATES } from '../src/watch/productUpdates.ts';
import { releaseHistory } from '../src/about/releases.ts';

const css = postcss.parse(readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'));
function value(selector: string, property: string) {
  let result: string | undefined;
  css.walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls(property, (decl) => { result = decl.value; });
  });
  return result;
}

test('every company card hover rule is restricted to a fine hover-capable pointer', () => {
  let checked = 0;
  css.walkRules((rule) => {
    if (!rule.selectors.some((selector) => selector.includes('.company-card') && selector.includes(':hover'))) return;
    let parent = rule.parent;
    let guarded = false;
    while (parent) {
      if (parent.type === 'atrule' && parent.name === 'media' && parent.params.includes('(hover: hover)') && parent.params.includes('(pointer: fine)')) guarded = true;
      parent = parent.parent;
    }
    assert.ok(guarded, rule.selector);
    checked++;
  });
  assert.ok(checked > 0);
});

test('light and dark card hover use distinct, visible neutral surfaces', () => {
  assert.equal(value('.career-app .company-card.entity-card:hover', 'background'), '#f0f2f4');
  assert.equal(value('.career-app .company-card.entity-card:hover', 'border-color'), '#d1d7de');
  assert.equal(value('[data-theme="dark"] .career-app .company-card.entity-card:hover', 'background'), '#181b1f');
  assert.equal(value('[data-theme="dark"] .career-app .company-card.entity-card:hover', 'border-color'), '#48515a');
});

test('the card only transitions surface colors, without geometry or shadow animation', () => {
  assert.equal(value('.career-app .company-card.entity-card', 'transition'), 'background-color 150ms ease, border-color 150ms ease');
  assert.equal(value('.career-app .company-card.entity-card:hover', 'box-shadow'), 'none');
  assert.equal(value('.career-app .company-card.entity-card:hover', 'transform'), 'none');
});

test('existing dark touch feedback and default card surface remain unchanged', () => {
  assert.equal(value('[data-theme="dark"] .career-app .company-card.entity-card', 'background'), '#08090a');
  assert.equal(value('[data-theme="dark"] .career-app .company-card.entity-card:active', 'background'), '#101214');
  assert.equal(value('[data-theme="dark"] .career-app .company-card.entity-card:active', 'border-color'), '#3a3f44');
});

test('this frontend release has one bilingual product announcement without fabricated time', () => {
  const records = PRODUCT_UPDATES.filter((record) => record.id === '2026-10-20-yami-company-hover-about-links');
  assert.equal(records.length, 1);
  assert.equal(records[0].date, '2026-10-20');
  assert.ok(records[0].changes.ja.length && records[0].changes.zh.length);
  assert.equal(releaseHistory(PRODUCT_UPDATES)[0].id, records[0].id);
});
