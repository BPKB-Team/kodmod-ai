// Explicit opt-in: real Next.js + editorial_server.py + isolated PostgreSQL.
import assert from "node:assert/strict";
import { test, before } from "node:test";
const enabled = process.env.EDITORIAL_PROXY_TEST === "1";
const origin = process.env.EDITORIAL_WEB_ORIGIN || "http://127.0.0.1:3118";
const api = "http://127.0.0.1:8118";
let fixture, cookies;
before(async () => {
  if (!enabled) return;
  fixture = await (await fetch(api + "/fixture")).json();
  assert.equal(
    fixture.fixture,
    "editorial-postgres",
    "Requires the isolated editorial fixture",
  );
  assert.match(fixture.schema, /^editorial_ui_fixture_[a-f0-9]{32}$/);
  cookies = {};
  for (const actor of ["owner", "reviewer", "admin", "student", "outsider"]) {
    const response = await fetch(api + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `editorial-${actor}`,
        password: "editorial-test-password-123",
      }),
    });
    assert.equal(response.status, 200);
    cookies[actor] = "kodmod_session=" + (await response.json()).access_token;
  }
});
const request = (path, actor, method = "GET", body, key) =>
  fetch(origin + "/api/editorial" + path, {
    method,
    headers: {
      ...(actor ? { Cookie: cookies[actor] } : {}),
      "Content-Type": "application/json",
      Origin: origin,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    redirect: "manual",
  });

test(
  "manual editorial flow crosses the real Next proxy without disclosing keys",
  { skip: !enabled },
  async () => {
    assert.equal((await request("/teacher/quizzes")).status, 401);
    assert.equal((await request("/teacher/quizzes", "student")).status, 403);
    const body = {
      subject_id: fixture.subject_id,
      title: "Pecahan dalam kehidupan sehari-hari",
      description: "Latihan dari Bu Rani untuk menguatkan pemahaman pecahan.",
      questions: [
        {
          order_index: 1,
          prompt: "Setengah ditambah setengah sama dengan?",
          narration: "Setengah ditambah setengah sama dengan berapa?",
          options: [
            { id: "a", label: "Satu" },
            { id: "b", label: "Dua" },
          ],
          correct_option_id: "a",
          explanation: "Dua bagian setengah membentuk satu bagian utuh.",
        },
        {
          order_index: 2,
          prompt: "Seperempat dari delapan adalah?",
          options: [
            { id: "a", label: "Dua" },
            { id: "b", label: "Empat" },
          ],
          correct_option_id: "a",
          explanation: "Delapan dibagi empat sama dengan dua.",
        },
      ],
    };
    let response = await request("/teacher/quizzes", "owner", "POST", body);
    assert.equal(response.status, 201, await response.clone().text());
    let draft = await response.json();
    const action = () => ({
      version_id: draft.version.id,
      expected_review_revision: draft.version.review_revision,
    });
    response = await request(
      `/teacher/quizzes/${draft.id}/reviewer`,
      "owner",
      "POST",
      { ...action(), reviewer_id: fixture.users.reviewer },
    );
    assert.equal(response.status, 200);
    draft = await response.json();
    response = await request(
      `/teacher/quizzes/${draft.id}/submit-review`,
      "owner",
      "POST",
      action(),
    );
    assert.equal(response.status, 200);
    draft = await response.json();
    const queue = await request("/quiz-reviews", "reviewer");
    assert.ok((await queue.json()).some((row) => row.id === draft.id));
    response = await request(
      `/teacher/quizzes/${draft.id}/approve`,
      "reviewer",
      "POST",
      { ...action(), note: "Soal dan pembahasan sudah sesuai." },
    );
    assert.equal(response.status, 200, await response.clone().text());
    draft = await response.json();
    response = await request(
      `/teacher/quizzes/${draft.id}/publish`,
      "owner",
      "POST",
      action(),
    );
    assert.equal(response.status, 200);
    draft = await response.json();
    response = await request(
      `/teacher/quizzes/${draft.id}/assignments`,
      "owner",
      "POST",
      { version_id: draft.version.id, class_id: fixture.class_id },
    );
    assert.equal(response.status, 201);
    const assignment = await response.json();
    assert.equal(
      (await request(`/student/assignments/${assignment.id}`, "outsider"))
        .status,
      404,
    );
    response = await request(
      `/student/assignments/${assignment.id}/start`,
      "student",
      "POST",
    );
    assert.equal(response.status, 201);
    let attempt = await response.json();
    assert.ok(!JSON.stringify(attempt).includes("correct_option_id"));
    assert.ok(!JSON.stringify(attempt).includes("explanation"));
    const page = await fetch(`${origin}/student/assignments/${assignment.id}`, {
      headers: { Cookie: cookies.student },
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Simpan.*lanjut/);
    assert.ok(
      !html.includes("correct_option_id") &&
        !html.includes("Dua bagian setengah membentuk"),
    );
    assert.ok(!html.includes(cookies.student.replace("kodmod_session=", "")));
    const replayStart = await request(
      `/student/assignments/${assignment.id}/start`,
      "student",
      "POST",
    );
    assert.equal(replayStart.status, 200);
    assert.equal((await replayStart.json()).id, attempt.id);
    for (const q of attempt.questions) {
      response = await request(
        `/student/assignments/${assignment.id}/answers/${q.id}`,
        "student",
        "PUT",
        { option_id: "a", expected_revision: attempt.revision },
      );
      assert.equal(response.status, 200);
      attempt = await response.json();
    }
    const key = crypto.randomUUID(),
      finalBody = { expected_revision: attempt.revision };
    response = await request(
      `/student/assignments/${assignment.id}/submit`,
      "student",
      "POST",
      finalBody,
      key,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.score, 100);
    await request(
      `/teacher/assignments/${assignment.id}/close`,
      "owner",
      "POST",
    );
    const replay = await request(
      `/student/assignments/${assignment.id}/submit`,
      "student",
      "POST",
      finalBody,
      key,
    );
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), result);
    const teacher = await request(
      `/teacher/assignments/${assignment.id}/results`,
      "owner",
    );
    assert.equal((await teacher.json()).submitted_count, 1);
    assert.equal(
      (
        await request(
          `/teacher/assignments/${assignment.id}/results`,
          "reviewer",
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(`/teacher/assignments/${assignment.id}/results`, "admin"))
        .status,
      403,
    );
  },
);

test(
  "proxy rejects unsafe origin and traversal; new pages require the appropriate role",
  { skip: !enabled },
  async () => {
    const cross = await fetch(origin + "/api/editorial/teacher/quizzes", {
      method: "POST",
      headers: {
        Cookie: cookies.owner,
        "Content-Type": "application/json",
        Origin: "https://outside.example",
      },
      body: "{}",
    });
    assert.equal(cross.status, 403);
    assert.equal(
      (await request("/teacher/quizzes/invalid", "owner")).status,
      404,
    );
    assert.equal(
      (await request("/teacher/quizzes?limit=999", "owner")).status,
      400,
    );
    for (const [path, actor, status] of [
      ["/teacher/quizzes", "owner", 200],
      ["/teacher/quizzes/new", "owner", 200],
      ["/teacher/quiz-reviews", "reviewer", 200],
      ["/admin/quiz-reviews", "admin", 200],
      ["/student/assignments", "student", 200],
      ["/teacher/quizzes", "student", 307],
      ["/student/assignments", "owner", 307],
    ]) {
      const page = await fetch(origin + path, {
        headers: { Cookie: cookies[actor] },
        redirect: "manual",
      });
      assert.equal(page.status, status, path);
      assert.ok(
        !(await page.text()).includes(
          cookies[actor].replace("kodmod_session=", ""),
        ),
      );
    }
  },
);
