import test from 'node:test';
import assert from 'node:assert/strict';
import { companyIdentityKey, evaluateIdentity, fetchPage, inspectRecruitmentContent } from '../src/monitor';
import { decodeBody, detectCharset } from '../src/reliability';

// 株式会社 encoded as Shift_JIS.
const SJIS_KABUSHIKI = [0x8a, 0x94, 0x8e, 0xae, 0x89, 0xef, 0x8e, 0xd0];
const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

test('Shift_JIS pages are decoded from the Content-Type header or a meta declaration', () => {
  const body = new Uint8Array([...ascii('<title>'), ...SJIS_KABUSHIKI, ...ascii('Aiming</title>')]);
  assert.equal(detectCharset(body, 'text/html; charset=Shift_JIS'), 'shift_jis');
  assert.match(decodeBody(body, 'text/html; charset=Shift_JIS'), /株式会社Aiming/);
  const withMeta = new Uint8Array([...ascii('<html><head><meta charset="shift_jis"><title>'), ...SJIS_KABUSHIKI, ...ascii('</title>')]);
  assert.equal(detectCharset(withMeta, 'text/html'), 'shift_jis');
  assert.match(decodeBody(withMeta, 'text/html'), /株式会社/);
  const httpEquiv = new Uint8Array(ascii('<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">'));
  assert.equal(detectCharset(httpEquiv, null), 'euc-jp');
});

test('UTF-8 stays the default and an unknown charset label falls back to UTF-8', () => {
  const utf8 = new TextEncoder().encode('<title>株式会社Aiming</title>');
  assert.equal(detectCharset(utf8, 'text/html'), 'utf-8');
  assert.match(decodeBody(utf8, 'text/html; charset=x-unknown-label'), /株式会社Aiming/);
});

test('fetchPage returns readable Japanese for a Shift_JIS recruitment page', async () => {
  const original = globalThis.fetch;
  const page = new Uint8Array([...ascii('<html><head><meta charset="Shift_JIS"></head><body><main><h1>'), ...SJIS_KABUSHIKI, ...ascii('Aiming</h1></main></body></html>')]);
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('dns-query')) return Response.json({ Answer: [{ type: 1, data: '198.51.100.10' }] });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  try { assert.match((await fetchPage('https://example.co.jp/recruit/')).html, /株式会社Aiming/); }
  finally { globalThis.fetch = original; }
});

test('English legal suffixes identify the same company instead of an identity mismatch', () => {
  for (const name of ['Aiming Inc.', 'AIMING Co., Ltd.', 'Aiming Corporation', 'Aiming K.K.']) assert.equal(companyIdentityKey(name), companyIdentityKey('株式会社Aiming'), name);
  assert.notEqual(companyIdentityKey('Aimingworks Inc.'), companyIdentityKey('株式会社Aiming'));
  const body = '<main><h1>未来をつくる仲間へ</h1><section><h2>募集要項</h2><p>募集職種はシステムエンジニアです。年間休日124日。</p><p>応募資格、勤務地、初任給、福利厚生を掲載しています。</p></section></main>';
  const analysis = inspectRecruitmentContent(`<html><head><title>採用情報 | Aiming Inc.</title></head><body>${body}</body></html>`, 'official', 'https://aiming-inc.com/recruit/', '株式会社Aiming');
  assert.equal(evaluateIdentity(analysis), null);
  assert.equal(analysis.detectedCompanyName, 'Aiming Inc.');
});

async function withDns(answers: { A?: unknown[]; AAAA?: unknown[] }, run: (calls: string[]) => Promise<void>) {
  const original = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes('dns-query')) return Response.json({ Answer: url.includes('type=AAAA') ? answers.AAAA : answers.A });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    return new Response('<main>Recruitment</main>', { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test('IPv6-only hosts are checked by AAAA and allowed when public', async () => {
  await withDns({ A: [], AAAA: [{ type: 28, data: '2001:db8::10' }] }, async (calls) => {
    assert.equal((await fetchPage('https://v6only.example/recruit')).status, 200);
    assert.ok(calls.some((url) => url.includes('type=AAAA')));
  });
});

test('private IPv6 answers and hosts without any address are still rejected', async () => {
  for (const data of ['fd00::1', 'fe80::1', '::1', '::ffff:10.0.0.1']) {
    await withDns({ A: [], AAAA: [{ type: 28, data }] }, async () => {
      await assert.rejects(fetchPage('https://v6only.example/recruit'), /URL_PRIVATE_HOST/, data);
    });
  }
  await withDns({ A: [], AAAA: [] }, async () => { await assert.rejects(fetchPage('https://nothing.example/recruit'), /URL_PRIVATE_HOST/); });
});
