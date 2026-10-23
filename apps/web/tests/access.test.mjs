// Start api-fixture.mjs and Next.js on port 3110 with API_ORIGIN=http://127.0.0.1:8109.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.WEB_TEST_ORIGIN || 'http://127.0.0.1:3110';
const apiOrigin = process.env.API_FIXTURE_ORIGIN || 'http://127.0.0.1:8109';
before(async () => {
  const response = await fetch(apiOrigin + '/auth/me', { headers: { Authorization: 'Bearer fixture-test-admin' } });
  assert.equal((await response.json()).username, 'admin.test', 'This suite requires the isolated fixture.');
});
const request = (path, token) => fetch(origin + path, { redirect: 'manual', headers: token ? { Cookie: `kodmod_session=${token}` } : {} });
for (const path of ['/admin', '/admin/users', '/admin/invitations', '/admin/users/new']) {
  test(`anonymous user cannot read ${path}`, async () => {
    const response = await request(path);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), '/login');
  });
}
for (const [legacy, canonical] of [
  ['/masuk?success=signed-out', '/login'],
  ['/guru/kelas/7f4a/materi/3bc2', '/teacher/classes/7f4a/materials/3bc2'],
  ['/siswa/tugas/3bc2', '/student/assignments/3bc2'],
  ['/admin/pengguna/baru', '/admin/users/new'],
]) {
  test(`legacy URL ${legacy} permanently redirects to ${canonical}`, async () => {
    const response = await request(legacy);
    assert.equal(response.status, 308);
    const destination = new URL(response.headers.get('location'), origin);
    assert.equal(destination.pathname, canonical);
    if (legacy.includes('?')) assert.equal(destination.search, '?success=signed-out');
  });
}
test('invalid session returns to login', async () => {
  const response = await request('/admin', 'invalid-session');
  assert.equal(response.headers.get('location'), '/login');
});
test('student cannot read admin user directory', async () => {
  const response = await request('/admin/users', 'fixture-test-student');
  assert.equal(response.headers.get('location'), '/student');
});
test('teacher cannot read admin invitations', async () => {
  const response = await request('/admin/invitations', 'fixture-test-teacher');
  assert.equal(response.headers.get('location'), '/teacher');
});
test('admin data renders without exposing the access token', async () => {
  const response = await request('/admin/users', 'fixture-test-admin');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('admin.test'));
  assert.ok(!html.includes('fixture-test-admin'));
  // next dev intentionally emits no-cache,must-revalidate; production uses private/no-store.
  assert.match(response.headers.get('cache-control'), /no-store|private|no-cache/);
});
