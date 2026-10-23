import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { attachMenuNarration, announcePageNavigation } from "../src/lib/menu-narration.mjs";

function view(html, state = { owner: null, status: "idle" }) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const queued = [], played = [];
  const speech = { getState: () => state, queueMenu: request => queued.push(request),
    cancelQueuedMenu() {}, stop() {}, play: async request => played.push(request) };
  const detach = attachMenuNarration({ document: dom.window.document, speech, language: "id", engine: "app", pathname: "/student/practice" });
  return { dom, document: dom.window.document, queued, played, speech,
    async settle() { await new Promise(resolve => setTimeout(resolve, 10)); },
    cleanup() { detach(); dom.window.close(); } };
}

test("labelled controls read their accessible label and ignore decorative content", () => {
  const f = view('<span id="filter-label">Status bacaan</span><button aria-labelledby="filter-label"><span aria-hidden="true">ikon</span>Semua materi</button>');
  try {
    f.document.querySelector("button").focus();
    assert.match(f.queued.at(-1)?.text ?? "", /Status bacaan/);
    assert.doesNotMatch(f.queued.at(-1)?.text ?? "", /ikon/);
  } finally { f.cleanup(); }
});

test("a selected answer is read even while the tutor is speaking", async () => {
  const f = view('<label><input type="radio" name="answer" value="private-id">A. Fotosintesis</label>', { owner: "tutor", status: "playing" });
  try {
    f.document.querySelector("input").click();
    await f.settle();
    assert.equal(f.queued.at(-1)?.text, "Pilihan A, Fotosintesis dipilih.");
    assert.equal(f.queued.at(-1)?.interrupt, true);
    assert.doesNotMatch(f.queued.at(-1)?.text ?? "", /private-id/);
  } finally { f.cleanup(); }
});

test("quiz card option narrates with option letter, short pause and text when selected", async () => {
  const f = view('<fieldset class="quiz-options"><label class="quiz-option"><input type="radio" name="answer-q1" value="opt-1" aria-label="Pilihan A, Bukti"><span class="quiz-option-key">A</span><span>Bukti</span></label><label class="quiz-option"><input type="radio" name="answer-q1" value="opt-2"><span class="quiz-option-key">B</span><span>Klaim</span></label></fieldset>');
  try {
    f.document.querySelector('input[value="opt-1"]').click();
    await f.settle();
    assert.equal(f.queued.at(-1)?.text, "Pilihan A, Bukti dipilih.");
    assert.equal(f.queued.at(-1)?.interrupt, true);

    f.document.querySelector('input[value="opt-2"]').click();
    await f.settle();
    assert.equal(f.queued.at(-1)?.text, "Pilihan B, Klaim dipilih.");
  } finally { f.cleanup(); }
});

test("a delayed action-button label must not replace a new spoken question", () => {
  const f = view('<button>Mulai latihan</button>', { owner: "tutor", status: "playing" });
  try {
    f.document.querySelector("button").click();
    assert.equal(f.queued.length, 0);
  } finally { f.cleanup(); }
});

test("checkbox state changes are announced without reading free-form values", async () => {
  const f = view('<label><input type="checkbox">Simpan materi</label><label>Kata sandi<input type="password" value="secret-123"></label>');
  try {
    const checkbox = f.document.querySelector("input");
    checkbox.click(); await f.settle();
    assert.match(f.queued.at(-1)?.text ?? "", /Simpan materi.*(dicentang|aktif)/i);
    const password = f.document.querySelector('[type="password"]');
    password.focus(); password.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
    assert.ok(f.queued.every(request => !request.text.includes("secret-123")));
  } finally { f.cleanup(); }
});

test("native select announces its field and selected option", async () => {
  const f = view('<label>Kelas<select><option>Semua kelas</option><option>Kelas 8</option></select></label>');
  try {
    const select = f.document.querySelector("select");
    select.focus();
    assert.match(f.queued.at(-1)?.text ?? "", /Kelas.*Semua kelas/);
    select.selectedIndex = 1; select.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
    await f.settle();
    assert.match(f.queued.at(-1)?.text ?? "", /Kelas 8.*dipilih/);
  } finally { f.cleanup(); }
});

test("progress tabs announce their selected state", async () => {
  const f = view('<button role="tab" aria-selected="true">30 hari</button>');
  try {
    f.document.querySelector("button").click(); await f.settle();
    assert.match(f.queued.at(-1)?.text ?? "", /30 hari.*Dipilih/);
  } finally { f.cleanup(); }
});

test("opening a native popup reads its title, description and available actions", async () => {
  const f = view('<dialog aria-labelledby="title" aria-describedby="body"><h2 id="title">Simpan jawaban?</h2><p id="body">Periksa jawabanmu terlebih dahulu.</p><button>Batal</button><button>Simpan</button></dialog>');
  try {
    f.document.querySelector("dialog").setAttribute("open", "");
    await f.settle();
    const text = [...f.queued, ...f.played].map(r => r.text).join(" ");
    assert.match(text, /Simpan jawaban/); assert.match(text, /Periksa jawabanmu/);
    assert.match(text, /Batal.*Simpan/);
  } finally { f.cleanup(); }
});

test("new errors are narrated, while voice-player status cannot create a speech loop", async () => {
  const f = view('<div id="content"></div><section data-voice-ignore><p role="status"></p></section>');
  try {
    f.document.getElementById("content").innerHTML = '<p role="alert">Jawaban belum tersimpan. Coba lagi.</p>';
    f.document.querySelector('[role="status"]').textContent = "Sedang membacakan.";
    await f.settle();
    assert.match([...f.queued, ...f.played].at(-1)?.text ?? "", /Jawaban belum tersimpan/);
    assert.ok([...f.queued, ...f.played].every(r => !r.text.includes("Sedang membacakan")));
  } finally { f.cleanup(); }
});

test("automatic modal focus preserves its introduction while keyboard navigation reads the next control", () => {
  const f = view('<dialog open><button>Batal</button><button>Simpan</button></dialog>');
  try {
    f.dom.window.dispatchEvent(new f.dom.window.CustomEvent("kodmod:dialog-announce", { detail: { text: "Simpan jawaban? Batal atau Simpan." } }));
    f.document.querySelector("button").focus();
    assert.equal(f.queued.length, 0, "automatic focus must not replace the popup introduction");
    f.document.dispatchEvent(new f.dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    f.document.querySelectorAll("button")[1].focus();
    assert.match(f.queued.at(-1)?.text ?? "", /Simpan/);
  } finally { f.cleanup(); }
});

test("navigation waits for a streamed destination heading and supports teacher pages", async () => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true });
  const played = [];
  const cleanup = announcePageNavigation({ document: dom.window.document, speech: { play: r => played.push(r) },
    language: "id", engine: "app", enabled: true, previousPathname: "/teacher", pathname: "/teacher/classes" });
  try {
    dom.window.document.querySelector("main").innerHTML = '<h1>Kelas saya</h1>';
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(played.map(r => r.text), ["Kelas saya"]);
    assert.equal(dom.window.document.activeElement.tagName, "H1");
  } finally { cleanup?.(); dom.window.close(); }
});

test("destination focus survives a late framework reset without stealing focus from another control", async () => {
  const dom = new JSDOM('<body tabindex="-1"><main><h1>Kelas</h1><button>Mulai</button></main></body>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const announce = () => announcePageNavigation({ document, speech: { play() {} }, language: "id", engine: "app", enabled: true, previousPathname: "/student", pathname: "/student/classes" });
  let cleanup = announce();
  try {
    document.body.focus();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(document.activeElement, document.querySelector("h1"));
    cleanup?.(); cleanup = announce(); document.querySelector("button").focus();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(document.activeElement, document.querySelector("button"));
  } finally { cleanup?.(); dom.window.close(); }
});
