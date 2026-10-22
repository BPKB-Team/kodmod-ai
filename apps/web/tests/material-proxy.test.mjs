// Requires an isolated API fixture and Next.js with API_ORIGIN pointing to it.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const origin = process.env.WEB_TEST_ORIGIN || "http://127.0.0.1:3110";
const api = process.env.API_FIXTURE_ORIGIN || "http://127.0.0.1:8119";
const classId = "10000000-0000-4000-8000-000000000001";
const materialId = "20000000-0000-4000-8000-000000000001";
const headers = (role = "student") => ({ Cookie: `kodmod_session=fixture-test-${role}` });
before(async () => {
  const response = await fetch(`${api}/auth/me`, { headers: { Authorization: "Bearer fixture-test-admin" } });
  assert.equal((await response.json()).username, "admin.test", "This suite requires the isolated fixture.");
});

test("material import proxy authenticates before reading uploads and preserves review text", async () => {
  const path = `/api/classes/${classId}/materials/import`;
  assert.equal((await fetch(origin + path, { method: "POST" })).status, 401);
  assert.equal((await fetch(origin + path, { method: "POST", headers: headers() })).status, 403);
  const data = new FormData();
  data.set("file", new File(["Pecahan adalah bagian dari keseluruhan."], "pecahan.txt", { type: "text/plain" }));
  const imported = await fetch(origin + path, { method: "POST", headers: headers("teacher"), body: data });
  assert.equal(imported.status, 202);
  const preview = await imported.json();
  assert.equal(preview.filename, "pecahan.txt");
  assert.match(preview.preview.content, /Pecahan/);
  const library = await fetch(`${api}/classes/student/materials`, { headers: { Authorization: "Bearer fixture-test-student" } });
  assert.equal((await library.json()).length, 3, "Import preview must not publish or save a material.");
});

test("chat proxy carries material context and returns persisted citations", async () => {
  const response = await fetch(`${origin}/api/chat/message`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ text: "Jelaskan pecahan", class_id: classId, material_id: materialId, student_id: "someone-else" }) });
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.equal(answer.context.material_id, materialId);
  assert.equal(answer.sources[0].class_id, classId);
  const history = await fetch(`${origin}/api/chat/sessions/${answer.session_id}`, { headers: headers() });
  assert.equal((await history.json()).turns[1].sources[0].material_id, materialId);
  const incomplete = await fetch(`${origin}/api/chat/message`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ text: "Halo", material_id: materialId }) });
  assert.equal(incomplete.status, 400);
});

test("material links open the guided tutor with the selected material", async () => {
  const tutorPath = `/siswa/tutor?class_id=${classId}&material_id=${materialId}`;
  const reader = await fetch(`${origin}/siswa/kelas/${classId}/materi/${materialId}`, { headers: headers(), redirect: "manual" });
  const readerHtml = await reader.text();
  if (reader.status === 307) {
    assert.equal(reader.headers.get("location"), tutorPath);
  } else {
    // Next.js emits a refresh tag when the surrounding layout has started streaming.
    assert.equal(reader.status, 200);
    const document = new JSDOM(readerHtml).window.document;
    const refresh = document.querySelector('meta[http-equiv="refresh"]')?.getAttribute("content");
    assert.equal(refresh?.split(";url=")[1], tutorPath);
  }
  assert.ok(!readerHtml.includes("fixture-test-student"));
  const tutor = await fetch(origin + tutorPath, { headers: headers() });
  assert.equal(tutor.status, 200);
  const html = await tutor.text();
  assert.match(html, /Pelajari materi bersama Tutor/);
  assert.match(html, /Memahami pecahan dalam keseharian/);
  assert.ok(html.includes(`initialMaterialId\\":\\"${materialId}`), "The selected material must be passed to the tutor UI.");
  assert.ok(!html.includes("fixture-test-student"));
  const invalid = await fetch(`${origin}/siswa/tutor?class_id=${classId}&material_id=other`, { headers: headers() });
  assert.match(await invalid.text(), /Halaman tidak ditemukan/);
});
