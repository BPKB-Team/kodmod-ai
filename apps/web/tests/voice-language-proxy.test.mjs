// Only the disposable api-fixture on loopback is allowed for this suite.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.WEB_TEST_ORIGIN;
const api = process.env.API_FIXTURE_ORIGIN;
const enabled = Boolean(origin && api);
before(async () => {
  if (!enabled) return;
  const response = await fetch(api + '/auth/me', { headers: { Authorization: 'Bearer fixture-test-admin' } });
  assert.equal((await response.json()).username, 'admin.test', 'This suite must target the isolated fixture.');
});
const headers = role => ({ 'Content-Type': 'application/json', ...(role ? { Cookie: 'kodmod_session=fixture-test-' + role } : {}) });
test('guests can preview fixed voices but cannot send arbitrary private speech', { skip: !enabled }, async () => {
  const preview = await fetch(origin + '/api/voice/menu/preview?language=id');
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /audio\/mpeg/);
  assert.ok((await preview.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(origin + '/api/voice/menu/not-a-menu')).status, 404);
  assert.equal((await fetch(origin + '/api/voice/menu/preview?language=fr')).status, 400);
  assert.equal((await fetch(origin + '/api/voice/tts', { method: 'POST', headers: headers(), body: JSON.stringify({ text: 'Private text' }) })).status, 401);
});
test('authenticated student teacher and admin speech stays private and follows the requested language', { skip: !enabled }, async () => {
  for (const role of ['student', 'teacher', 'admin']) {
    const response = await fetch(origin + '/api/voice/tts', { method: 'POST', headers: headers(role), body: JSON.stringify({ text: 'Fixture speech ' + role, language: 'en' }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(response.headers.get('content-type'), /audio\/mpeg/);
  }
  const recorded = await (await fetch(api + '/__fixture/voice')).json();
  for (const role of ['student', 'teacher', 'admin']) assert.ok(recorded.requests.some(r => r.user === 'test-' + role && r.language === 'en'));
});
test('generated markdown and LaTeX are normalized before reaching the speech service', { skip: !enabled }, async () => {
  const response = await fetch(origin + '/api/voice/tts', {
    method: 'POST',
    headers: headers('student'),
    body: JSON.stringify({
      text: '# Ringkasan **pecahan**\n\n1. Gunakan `3/4` dari 24 benda.\nRumus: $\\frac{1}{2} \\times 8 = 4$.',
      language: 'id',
    }),
  });
  assert.equal(response.status, 200);
  const recorded = await (await fetch(api + '/__fixture/voice')).json();
  const forwarded = recorded.requests.find(request => request.user === 'test-student' && request.text?.includes('Ringkasan pecahan'));
  assert.ok(forwarded);
  assert.equal(forwarded.language, 'id');
  assert.equal(forwarded.text, 'Ringkasan pecahan Pertama, Gunakan 3 per 4 dari 24 benda.\nRumus: 1 per 2 kali 8 sama dengan 4.');
  assert.doesNotMatch(forwarded.text, /[#*$`{}\\]|\\\\frac|\\\\times/);
});
test('profile scope is account-specific while guest menu audio is reusable', { skip: !enabled }, async () => {
  const profiles = await Promise.all([null, 'student', 'teacher'].map(async role => {
    const response = await fetch(origin + '/api/voice/profile', { headers: headers(role) });
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.equal(profiles[0].scope, 'guest');
  assert.notEqual(profiles[1].scope, profiles[2].scope);
  assert.match(profiles[1].scope, /^[a-f0-9]{64}$/);
  assert.equal(profiles[0].profile, profiles[1].profile);
});
test('private speech validation rejects oversized text and unsupported language', { skip: !enabled }, async () => {
  for (const body of [{ text: 'x'.repeat(5001) }, { text: 'Hello', language: 'fr' }]) {
    assert.equal((await fetch(origin + '/api/voice/tts', { method: 'POST', headers: headers('student'), body: JSON.stringify(body) })).status, 400);
  }
});
test('language persists to the authenticated account and a same-origin cookie', { skip: !enabled }, async () => {
  const response = await fetch(origin + '/api/preferences/language', { method: 'POST', headers: { ...headers('student'), Origin: origin }, body: JSON.stringify({ language: 'en' }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /kodmod_language=en/);
  const account = await (await fetch(api + '/auth/me', { headers: { Authorization: 'Bearer fixture-test-student' } })).json();
  assert.equal(account.preferred_language, 'en');
  const foreign = await fetch(origin + '/api/preferences/language', { method: 'POST', headers: { ...headers('student'), Origin: 'https://outside.example' }, body: JSON.stringify({ language: 'id' }) });
  assert.equal(foreign.status, 403);
  const html = await (await fetch(origin + '/daftar', { headers: { Cookie: 'kodmod_language=en' } })).text();
  assert.match(html, /lang="en"/);
  assert.ok(!html.includes('name="invitation_code"'));
  assert.ok(html.includes('Create your KODMOD account'));
});
