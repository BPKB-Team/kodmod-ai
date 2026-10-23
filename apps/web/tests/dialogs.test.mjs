import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const boundary = { open: true, callbacks: new Set(), calls: [], announcements: [] };
globalThis.kodmodDialogBoundary = boundary;
globalThis.document = { documentElement: { lang: 'en' }, querySelector: () => boundary.open ? {} : null, body: {} };
globalThis.window = { matchMedia: () => ({ matches: true }), dispatchEvent: event => boundary.announcements.push(event.detail) };
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() { boundary.callbacks.add(this.callback); }
  disconnect() { boundary.callbacks.delete(this.callback); }
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'sweetalert2') return { url: 'data:text/javascript,' + encodeURIComponent(`export default { isVisible: () => false, mixin: (defaults) => ({ fire: async (options) => { globalThis.kodmodDialogBoundary.calls.push({...defaults, ...options}); return { isConfirmed: true }; } }) };`), shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL('../src/' + specifier.slice(2), import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { notifyResult, confirmAction } = await import('../src/lib/dialogs.ts');
hooks.deregister();
test('pending action feedback waits for native voice settings to close', async () => {
  boundary.open = true; boundary.calls = [];
  const notification = notifyResult('Akun berhasil dibuat. Selamat memulai perjalanan bersama KODMOD.');
  await Promise.resolve();
  assert.equal(boundary.calls.length, 0, 'Swal must never open behind a native modal');
  boundary.open = false;
  for (const callback of boundary.callbacks) callback();
  await notification;
  assert.equal(boundary.calls.length, 1);
  assert.equal(boundary.calls[0].titleText, 'Done');
  assert.equal(boundary.callbacks.size, 0);
});
test('a confirmation also waits until the native dialog releases the top layer', async () => {
  boundary.open = true; boundary.calls = [];
  const confirmation = confirmAction({ title: 'Keluar dari akun?', text: 'Anda dapat masuk kembali kapan saja.' });
  await Promise.resolve();
  assert.equal(boundary.calls.length, 0);
  boundary.open = false;
  for (const callback of boundary.callbacks) callback();
  assert.equal(await confirmation, true);
});

test('public login confirmation announces after the popup opens and includes both actions', async () => {
  boundary.open = false; boundary.calls = []; boundary.announcements = [];
  await confirmAction({ title: 'Masuk ke KODMOD?', text: 'Lanjutkan masuk menggunakan akun yang telah Anda isi.', confirmText: 'Ya, masuk' });
  assert.equal(boundary.announcements.length, 0, 'Opening must happen before its spoken introduction');
  const keys = [];
  boundary.calls[0].didOpen({ querySelector: () => ({ setAttribute: (name, value) => keys.push([name, value]) }) });
  assert.equal(boundary.announcements[0].menuKey, 'dialog-login');
  assert.match(boundary.announcements[0].text, /Cancel.*Sign in/);
  assert.deepEqual(keys.map(item => item[1]), ['dialog-cancel', 'login-confirm']);
});

for (const language of ['id', 'en']) {
  test(`login popup text, button and announcement use explicit ${language} before html language catches up`, async () => {
    boundary.open = false; boundary.calls = []; boundary.announcements = [];
    document.documentElement.lang = language === 'en' ? 'id' : 'en';
    document.cookie = `kodmod_language=${document.documentElement.lang}`;
    await notifyResult('Anda berhasil masuk. Selamat datang di ruang KODMOD.', false, language);
    const options = boundary.calls[0];
    assert.equal(options.titleText, language === 'en' ? 'Done' : 'Berhasil');
    assert.equal(options.text, language === 'en' ? 'You are signed in. Welcome to KODMOD.' : 'Anda berhasil masuk. Selamat datang di ruang KODMOD.');
    assert.equal(options.confirmButtonText, language === 'en' ? 'Got it' : 'Mengerti');
    options.didOpen({ querySelector: () => ({ setAttribute() {} }) });
    assert.ok(boundary.announcements[0].text.includes(options.text));
    assert.ok(boundary.announcements[0].text.includes(options.confirmButtonText));
  });
}

test('dialog callers without a language use the saved browser choice before html catches up', async () => {
  boundary.calls = [];
  document.documentElement.lang = 'id';
  document.cookie = 'kodmod_language=en';
  await notifyResult('Anda sudah keluar dari akun dengan aman.');
  assert.equal(boundary.calls[0].confirmButtonText, 'Got it');
});

test('long dictionary messages translate before paragraph formatting', async () => {
  boundary.calls = [];
  await notifyResult('Indeks materi ini perlu diproses ulang oleh guru. Setelah pemrosesan selesai, coba mulai latihan kembali.', true, 'en');
  assert.match(boundary.calls[0].text, /index needs to be rebuilt/);
  assert.doesNotMatch(boundary.calls[0].text, /Indeks materi/);
});
