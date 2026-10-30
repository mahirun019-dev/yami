import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planCopy } from '../src/plans/i18n.ts';
import { PRODUCT_UPDATES } from '../src/watch/productUpdates.ts';

const component = readFileSync(new URL('../src/plans/PlanSettings.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/plans/plans.css', import.meta.url), 'utf8');
test('both languages expose identical plan information with existing sync free', () => {
  assert.deepEqual(Object.keys(planCopy.ja).sort(), Object.keys(planCopy.zh).sort());
  assert.ok(planCopy.ja.freeFeatures.includes('既存の端末間データ同期'));
  assert.ok(planCopy.zh.freeFeatures.includes('现有跨设备数据同步'));
  for (const copy of Object.values(planCopy)) {
    assert.equal(copy.freeFeatures.length, 6);
    assert.equal(copy.proFeatures.length, 4);
    assert.ok(copy.proNote && copy.experiment && copy.priceNote && copy.protection);
    assert.doesNotMatch(copy.proFeatures.join(''), /\d/);
  }
});
test('plans are presentation only, without purchase, permissions or data mutations', () => {
  assert.doesNotMatch(component, /fetch\(|localStorage|sessionStorage|useWatch|setData|onClick|<button|<a\b|<form|stripe|checkout|subscriptionId/i);
  assert.match(component, /¥0/);
  assert.match(component, /¥490/);
  assert.match(component, /copy\.preparing/);
  assert.match(component, /copy\.noPurchase/);
});
test('desktop and mobile route to the same pure component', () => {
  assert.match(app, /pageValue === "plans"\) return <PlanSettings locale=\{locale\} mobile/);
  assert.match(app, /tab === "plans" && <PlanSettings locale=\{locale\}/);
  assert.match(app, /changePage\("plans"\)/);
});
test('plan styles stay scoped, scale with preference and allow narrow single columns', () => {
  assert.match(css, /minmax\(min\(100%, 260px\), 1fr\)/);
  assert.match(css, /var\(--reading-scale, 1\)/);
  assert.match(css, /\[data-theme="dark"\] \.settings-plan-page/);
  assert.doesNotMatch(css, /font-size:\s*\d+px/);
});
test('one bilingual date-only release announcement confirms no charging', () => {
  const records = PRODUCT_UPDATES.filter(record => record.id === '2026-10-30-yami-plan-preview');
  assert.equal(records.length, 1);
  assert.equal(records[0].date, '2026-10-30');
  assert.match(records[0].summary.ja, /課金は開始していません/);
  assert.match(records[0].summary.zh, /尚未开放收费/);
});
