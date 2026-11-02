'use strict';
/* app/net.js: the one way the app asks the web (ADDONS.md section 8). Only hosts addon.json lists, over HTTPS;
   a redirect is followed on the same host only; an answer is read in chunks and refused once past its limit. The
   network is faked. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const Net = require('../net');

let calls = [];
function serve(handler) {
  calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), redirect: opts.redirect }); return handler(new URL(url)); };
}
const redirect = to => new Response(null, { status: 302, headers: { location: to } });

test('only the hosts addon.json lists, and their subdomains, over HTTPS', async () => {
  serve(() => new Response('{"ok":true}', { status: 200 }));
  await assert.rejects(Net.get('https://example.com/x'), /not in addon.json/);
  await assert.rejects(Net.get('https://metabot.gg.example.com/x'), /not in addon.json/);
  await assert.rejects(Net.get('http://metabot.gg/x'), /only HTTPS/);
  assert.equal(calls.length, 0, 'nothing asked');
  const r = await Net.get('https://metabot.gg/en/aion-2/crafting');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { ok: true });
  assert.equal(calls[0].redirect, 'manual', 'redirects are never followed by fetch itself');
  assert.ok(Net.allowed('assets.playnccdn.com') && Net.allowed('cdn.metabot.gg'));
});

test('a redirect on the same host is followed; to another host it is refused, not followed', async () => {
  serve(u => (u.pathname === '/a' ? redirect('/b') : new Response('here', { status: 200 })));
  const r = await Net.get('https://metabot.gg/a');
  assert.equal(r.text(), 'here');
  assert.equal(r.url, 'https://metabot.gg/b');
  assert.equal(calls.length, 2);
  serve(() => redirect('https://a2-tracker.com/elsewhere'));
  await assert.rejects(Net.get('https://metabot.gg/a'), /redirected to a2-tracker\.com: refused/);
  assert.equal(calls.length, 1, 'even a listed host: another host is another host');
  serve(() => redirect('http://metabot.gg/plain'));
  await assert.rejects(Net.get('https://metabot.gg/a'), /refused/, 'nor down to plain HTTP');
  serve(() => redirect('/again'));
  await assert.rejects(Net.get('https://metabot.gg/a'), /too many redirects/);
  assert.equal(calls.length, Net.HOPS + 1);
});

test('an answer is read in chunks and refused once past its limit, whether it says its size or not', async () => {
  serve(() => new Response('x'.repeat(100), { status: 200, headers: { 'content-length': '100' } }));
  await assert.rejects(Net.get('https://metabot.gg/i.webp', { max: 50 }), /too large/);
  let pulled = 0;
  serve(() => new Response(new ReadableStream({ pull(c) { pulled++; if (pulled > 1000) c.close(); else c.enqueue(new Uint8Array(1024)); } }), { status: 200 }));
  await assert.rejects(Net.get('https://metabot.gg/i.webp', { max: 4096 }), /too large/);
  assert.ok(pulled < 20, 'stopped soon after the limit, not read whole (' + pulled + ' chunks)');
  serve(() => new Response('small', { status: 200 }));
  assert.equal((await Net.get('https://metabot.gg/i.webp', { max: 4096 })).text(), 'small');
});

test('a refusal or a missing page comes back as an answer: the caller decides what it means', async () => {
  serve(() => new Response('{"ok":false,"error":"access_restricted"}', { status: 403 }));
  const r = await Net.get('https://a2-tracker.com/api.crafting.ashx');
  assert.equal(r.status, 403);
  assert.equal(r.ok, false);
  assert.equal(r.json().error, 'access_restricted');
});

test('nothing in the app asks the web except through net.js', () => {
  const dir = path.join(__dirname, '..');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'net.js')) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /\bfetch\(/, f + ' calls fetch itself');
  }
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '..', 'tools', 'make-recipes.js'), 'utf8'), /\bfetch\(/, 'the release tool too');
});
