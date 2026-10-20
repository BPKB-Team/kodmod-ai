// Disposable, local-only learning data. No production imports or database writes.
import { validateMaterialFile } from "../src/lib/material-flow.mjs";
import { parseQuizSubmission } from "../src/lib/quiz-submission.mjs";
import { randomUUID } from "node:crypto";
export function createLearningFixture({ legacyPending = false, quizFailureQueue = [], quizRequests = [] } = {}) {
  const classes = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Matematika VIII A",
      subject: "Matematika",
      description:
        "Belajar mengenali pola, memahami bilangan, dan menjelaskan alasan.",
      teacher_name: "Ratna Dewi",
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Bahasa Indonesia VIII A",
      subject: "Bahasa Indonesia",
      description:
        "Menemukan gagasan dan menyampaikan cerita dengan kata-kata sendiri.",
      teacher_name: "Ratna Dewi",
    },
  ].map((c) => ({
    ...c,
    is_archived: false,
    member_count: 1,
    created_at: "2026-09-16T00:00:00Z",
  }));
  const materials = [
    {
      id: "20000000-0000-4000-8000-000000000001",
      class_id: classes[0].id,
      title: "Memahami pecahan dalam keseharian",
      content:
        "Pecahan adalah bagian dari keseluruhan.\n\nBayangkan satu roti dibagi menjadi empat bagian yang sama besar. Setiap bagian adalah satu per empat dari roti tersebut. Dua bagian berarti dua per empat, yang nilainya sama dengan satu per dua.\n\nPembilang menyatakan banyak bagian yang diambil. Penyebut menyatakan banyak bagian sama besar dalam satu keseluruhan.\n\nCoba pikirkan: jika ada delapan potong roti dan kamu mengambil dua, berapa bagian yang kamu ambil? Jelaskan dengan kata-katamu sendiri.",
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      class_id: classes[0].id,
      title: "Mengenal bilangan bulat",
      content:
        "Bilangan bulat meliputi bilangan negatif, nol, dan bilangan positif.\n\nSuhu lima derajat di bawah nol ditulis negatif lima. Ketika suhu naik tujuh derajat, suhu akhirnya menjadi dua derajat di atas nol.\n\nCoba jelaskan perubahan suhu tersebut menggunakan kata-katamu sendiri.",
    },
    {
      id: "20000000-0000-4000-8000-000000000003",
      class_id: classes[1].id,
      title: "Menemukan gagasan utama",
      content:
        "Gagasan utama adalah inti yang dibahas dalam sebuah paragraf. Kalimat lain membantu menjelaskan inti tersebut.\n\nBaca sebuah paragraf, lalu tanyakan: paragraf ini terutama membahas apa? Cobalah merangkumnya dalam satu kalimat.",
    },
  ].map((m) => ({ ...m, published: true, source_filename: null, rag_status: "ready", rag_error: null, n_chunks: 2, content_version: 1, indexed_version: 1, created_at: "2026-09-16T00:00:00Z" }));
  if (legacyPending) Object.assign(materials[0], { rag_status: "pending", indexed_version: 0, n_chunks: 0 });
  let materialSerial = 4;
  const progress = new Map();
  const imports = new Map();
  const empty = () => ({
    completed: false,
    bookmarked: false,
    completed_at: null,
  });
  const state = (user, id) => progress.get(`${user.id}:${id}`) || empty();
  const chatSessions = new Map();
  let chatSerial = 1;
  const sessionsFor = (user) => {
    let sessions = chatSessions.get(user.id);
    if (!sessions) {
      sessions = new Map();
      chatSessions.set(user.id, sessions);
    }
    return sessions;
  };
  const sessionSummary = (session) => ({
    id: session.id,
    title: session.title,
    subject_id: session.subject_id,
    subject_name: session.subject_id ? "Matematika" : null,
    started_at: session.started_at,
    ended_at: session.ended_at || null,
    context: session.context || null,
  });
  const tutorReply = (text) =>
    /pecahan/i.test(text)
      ? "Pecahan menunjukkan bagian dari satu keseluruhan. Misalnya, satu roti dibagi menjadi empat bagian sama besar. Satu bagian disebut satu per empat."
      : "Mari kita uraikan pertanyaanmu langkah demi langkah. Bagian mana yang ingin kamu pahami lebih dulu?";
  const quizSessions = new Map();
  let quizSerial = 1;
  const quizQuestion = (sessionId, index, difficulty) => ({
    question_id: randomUUID(),
    order_index: index,
    question:
      index === 0
        ? "Jika satu roti dibagi menjadi empat bagian sama besar, satu bagian disebut apa?"
        : "Berapa nilai dua per empat jika disederhanakan?",
    question_type: "mcq",
    options: index === 0 ? ["Satu per empat", "Satu per dua"] : ["Satu per empat", "Satu per dua"],
    difficulty,
  });
  const metadata = (m) => ({
    id: m.id,
    class_id: m.class_id,
    title: m.title,
    published: m.published,
    created_at: m.created_at,
    source_filename: m.source_filename,
    rag_status: m.rag_status,
    rag_error: m.rag_error,
    n_chunks: m.n_chunks,
    content_version: m.content_version,
    indexed_version: m.indexed_version,
  });
  return (req, url, body, user, send) => {
    if (url.pathname === "/subjects" && req.method === "GET") {
      send(200, [{ id: "40000000-0000-4000-8000-000000000001", name: "Matematika", n_concepts: 0 }]);
      return true;
    }
    if (/^\/subjects\/[^/]+\/concepts$/.test(url.pathname) && req.method === "GET") {
      send(200, []);
      return true;
    }
    if (req.method === "GET" && ["/learning/active", "/quiz/active"].includes(url.pathname)) {
      send(user.role === "student" ? 200 : 403, user.role === "student" ? [] : {});
      return true;
    }
    if (req.method === "GET" && url.pathname.startsWith("/admin/materials")) {
      if (user.role !== "admin") { send(403, {}); return true; }
      const items = materials.map(m => ({ ...metadata(m), class_name: classes.find(c => c.id === m.class_id).name,
        subject: classes.find(c => c.id === m.class_id).subject, teacher_name: "Ratna Dewi", is_archived: false,
        teacher_id: "test-teacher", updated_at: m.created_at }));
      const id = url.pathname.split("/")[3];
      if (id) {
        const material = items.find(m => m.id === id);
        send(material ? 200 : 404, material ? { ...material, content: materials.find(m => m.id === id).content } : {});
      } else send(200, { items, total: items.length, limit: 25, offset: 0 });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/admin/insights/ai-usage") {
      send(user.role === "admin" ? 200 : 403, user.role !== "admin" ? {} : {
        generated_at: "2026-10-04T12:00:00Z", recent_requests: [],
        elevenlabs: { enabled: true, configured: true, available: false, tier: null, character_count: null,
          character_limit: null, next_reset_unix: null, tts_model: "eleven_multilingual_v2", tts_voice_id: "fixture", stt_backend: "elevenlabs" },
        openai: { configured: true, usage_available: false, total_tokens: null, prompt_tokens: null, completion_tokens: null,
          models: { tutor: "gpt-6-luna", router: "gpt-6-luna", quiz: "gpt-6-luna", embedding: "fixture" } },
        openai_costs: { configured: false, available: false, period_days: 30, currency: "USD", total_usd: null, total_idr: null, exchange_rate: null, exchange_rate_date: null, fetched_at: "2026-10-20T12:00:00Z", error_code: "admin_key_missing" },
      });
      return true;
    }
    if (
      url.pathname === "/admin/insights/overview" ||
      url.pathname === "/admin/activity"
    ) {
      if (user.role !== "admin") {
        send(403, {});
        return true;
      }
      if (url.pathname === "/admin/insights/overview" && req.method === "GET") {
        send(200, {
          generated_at: "2026-09-22T00:00:00Z",
          users: { total: 12, active: 10, students: 8, teachers: 3, admins: 1 },
          learning: { classrooms: 4, sessions: 22, open_sessions: 3, quiz_sessions: 17 },
          invitations: { active: 5 },
          providers: {
            elevenlabs: { enabled: false, configured: true, tts_backend: "piper", stt_backend: "faster-whisper" },
          },
        });
      } else if (url.pathname === "/admin/activity" && req.method === "GET") {
        const category = url.searchParams.get("category");
        const allItems = [
          {
            id: "activity-1",
            type: "learning_session",
            category: "learning",
            action: "session.ended",
            actor_name: "Siswa Uji",
            actor_role: "student",
            target_name: "Memahami pecahan",
            occurred_at: "2026-09-22T00:00:00Z",
          },
          {
            id: "audit-1",
            type: "audit_event",
            category: "account",
            action: "user.created",
            actor_name: "Admin Uji",
            actor_role: "admin",
            target_name: "Guru Baru (@guru_baru)",
            details: { role: "teacher" },
            occurred_at: "2026-09-22T01:00:00Z",
          },
        ];
        const filtered = category ? allItems.filter((i) => i.category === category) : allItems;
        send(200, {
          items: filtered,
          limit: Number(url.searchParams.get("limit") || 30),
          category: category || null,
          generated_at: "2026-09-22T00:00:00Z",
        });
      } else {
        send(404, {});
      }
      return true;
    }
    if (url.pathname.startsWith("/teacher")) {
      if (user.role !== "teacher") {
        send(403, {});
        return true;
      }
      const window = url.searchParams.get("window") || "week";
      const analyticsFor = (studentId, studentName, selectedWindow) => ({
        student_id: studentId,
        student_name: studentName,
        window: selectedWindow,
        n_sessions: 3,
        total_minutes: 54,
        interaction_count: 11,
        n_quiz_attempts: 4,
        quiz_accuracy: studentId === "student-1" ? 0.58 : 0.86,
        avg_quiz_score: studentId === "student-1" ? 0.52 : 0.82,
        overall_mastery: studentId === "student-1" ? 0.47 : 0.81,
        weak_concepts: [
          { concept_id: "concept-pecahan", concept_name: "Pecahan", mastery: 0.35, n_attempts: 3 },
        ],
        strong_concepts: [],
        open_misconceptions: [],
        engagement_index: studentId === "student-1" ? 0.32 : 0.72,
        active_recommendations: [],
        generated_at: "2026-09-22T00:00:00Z",
      });
      const students = [
        { id: "student-1", name: "Alya Pratama" },
        { id: "student-2", name: "Bima Santoso" },
      ];
      const session = {
        id: "teacher-session-1",
        title: "Memahami pecahan",
        subject_name: "Matematika",
        mode: "tutoring",
        started_at: "2026-09-21T10:00:00Z",
        ended_at: "2026-09-21T10:12:00Z",
      };
      if (url.pathname === "/teacher/students" && req.method === "GET") {
        send(200, {
          window,
          n_students: students.length,
          avg_mastery: 0.64,
          avg_quiz_accuracy: 0.72,
          avg_engagement_index: 0.52,
          cohort_weak_concepts: [
            { concept_name: "Pecahan", avg_mastery: 0.43, n_students: 1 },
          ],
          students: students.map((item) => {
            const analytics = analyticsFor(item.id, item.name, window);
            return {
              student_id: item.id,
              student_name: item.name,
              overall_mastery: analytics.overall_mastery,
              quiz_accuracy: analytics.quiz_accuracy,
              engagement_index: analytics.engagement_index,
              n_sessions: analytics.n_sessions,
              open_misconceptions: 0,
            };
          }),
          generated_at: "2026-09-22T00:00:00Z",
        });
      } else if (url.pathname === "/teacher/students/student-1" && req.method === "GET") {
        send(200, {
          account: { id: "student-1", username: "alya", full_name: "Alya Pratama", role: "student", is_active: true },
          analytics: analyticsFor("student-1", "Alya Pratama", window),
          teacher_summary: "Alya perlu perhatian pada konsep pecahan dan ritme latihan.",
        });
      } else if (url.pathname === "/teacher/students/student-1/sessions" && req.method === "GET") {
        send(200, [session]);
      } else if (url.pathname === "/teacher/sessions/teacher-session-1" && req.method === "GET") {
        send(200, {
          id: session.id,
          student_id: "student-1",
          title: session.title,
          started_at: session.started_at,
          turns: [
            { role: "student", text: "Apa itu pecahan?", intent: "tutoring", timestamp: session.started_at },
            { role: "assistant", text: "Pecahan adalah bagian dari keseluruhan.", intent: "tutoring", timestamp: "2026-09-21T10:01:00Z" },
          ],
        });
      } else {
        send(404, {});
      }
      return true;
    }
    if (url.pathname.startsWith("/analytics")) {
      if (user.role !== "student") {
        send(403, {});
        return true;
      }
      const window = url.searchParams.get("window") || "week";
      const summary = {
        student_id: user.id,
        student_name: "Siswa Uji",
        window,
        n_sessions: 4,
        total_minutes: 86.5,
        interaction_count: 18,
        n_quiz_attempts: 6,
        quiz_accuracy: 0.833,
        avg_quiz_score: 0.79,
        overall_mastery: 0.68,
        weak_concepts: [
          { concept_id: "concept-pecahan", concept_name: "Pecahan", mastery: 0.42, n_attempts: 4 },
        ],
        strong_concepts: [
          { concept_id: "concept-bilangan", concept_name: "Bilangan bulat", mastery: 0.88, n_attempts: 5 },
        ],
        open_misconceptions: [],
        engagement_index: 0.61,
        active_recommendations: [
          {
            id: "recommendation-1",
            kind: "practice",
            title: "Latihan pecahan bertahap",
            body: "Coba dua soal pecahan dengan bantuan tutor.",
            priority: 1,
          },
        ],
        generated_at: "2026-09-22T00:00:00Z",
      };
      if (url.pathname === "/analytics/me" && req.method === "GET") {
        send(200, summary);
      } else if (url.pathname === "/analytics/me/spoken" && req.method === "GET") {
        send(200, {
          summary,
          spoken: "Progress minggu ini menunjukkan kamu semakin percaya diri memahami konsep pecahan.",
        });
      } else {
        send(404, {});
      }
      return true;
    }
    if (url.pathname.startsWith("/quiz")) {
      if (user.role !== "student") {
        send(403, {});
        return true;
      }
      if (url.pathname === "/quiz/start" && req.method === "POST") {
        const count = Number(body.n_questions ?? 5);
        if (!Number.isInteger(count) || count < 1 || count > 20) {
          send(422, {});
          return true;
        }
        const id = `40000000-0000-4000-8000-${String(quizSerial++).padStart(12, "0")}`;
        const difficulty = ["easy", "medium", "hard"].includes(body.difficulty)
          ? body.difficulty
          : "medium";
        const questions = Array.from({ length: count }, (_, index) =>
          quizQuestion(id, index, difficulty),
        );
        quizSessions.set(id, { studentId: user.id, questions, current: 0, correct: 0, attempts: 0, tries: 0, receipts: new Map() });
        send(200, {
          quiz_session_id: id,
          first_question: questions[0],
          total_questions: questions.length,
        });
      } else if (url.pathname === "/quiz/submit" && req.method === "POST") {
        quizRequests.push(structuredClone(body));
        try { body = parseQuizSubmission(body); } catch { send(422, { detail: "Data jawaban tidak valid." }); return true; }
        const failure = quizFailureQueue.shift();
        if (failure && failure !== 503) { send(failure, { detail: "Simulasi kegagalan pengiriman." }); return true; }
        const quiz = quizSessions.get(body.quiz_session_id);
        if (!quiz || quiz.studentId !== user.id) {
          send(404, {});
          return true;
        }
        const previous = quiz.receipts.get(body.submission_id);
        if (previous) {
          send(JSON.stringify(previous.body) === JSON.stringify(body) ? 200 : 409, previous.result);
          return true;
        }
        const current = quiz.questions[quiz.current];
        if (!current || body.question_id !== current.question_id) {
          send(409, {});
          return true;
        }
        const isCorrect = String(body.student_answer || "").trim().toLowerCase() === "a" ||
          String(body.student_answer || "").trim().toLowerCase() === "satu per empat";
        if (isCorrect) quiz.correct += 1;
        quiz.attempts += 1;
        quiz.tries += 1;
        if (isCorrect || quiz.tries >= 3) { quiz.current += 1; quiz.tries = 0; }
        const complete = quiz.current >= quiz.questions.length;
        const result = {
          score: isCorrect ? 1 : 0,
          is_correct: isCorrect,
          feedback: isCorrect ? "Jawabanmu tepat." : "Coba periksa kembali pembilang dan penyebutnya.",
          cumulative_score: quiz.correct / quiz.attempts,
          quiz_complete: complete,
          final_summary: complete ? `Kuis selesai. Skor kamu ${Math.round((quiz.correct / quiz.attempts) * 100)}%.` : null,
          next_question: complete ? null : quiz.questions[quiz.current],
        };
        quiz.receipts.set(body.submission_id, { body, result });
        // Model a committed result whose response was lost, then replay it.
        send(failure === 503 ? 503 : 200, failure === 503 ? { detail: "Hasil belum dapat dipastikan." } : result);
      } else {
        send(404, {});
      }
      return true;
    }
    if (url.pathname.startsWith("/chat")) {
      if (user.role !== "student") {
        send(403, {});
        return true;
      }
      const sessions = sessionsFor(user);
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/chat/sessions" && req.method === "GET") {
        send(
          200,
          [...sessions.values()]
            .sort((a, b) => b.started_at.localeCompare(a.started_at))
            .map(sessionSummary),
        );
      } else if (url.pathname === "/chat/message" && req.method === "POST") {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text || text.length > 4_000) {
          send(422, {});
        } else {
          let session = body.session_id ? sessions.get(body.session_id) : undefined;
          let context = session?.context || null;
          const hasContext = body.class_id || body.material_id;
          if (hasContext) {
            const material = materials.find((item) => item.id === body.material_id && item.class_id === body.class_id && item.published);
            const room = classes.find((item) => item.id === body.class_id && !item.is_archived);
            if (!material || !room || user.id !== "test-student") { send(404, {}); return true; }
            if (material.rag_status !== "ready") { send(409, {}); return true; }
            if (session && (context?.class_id !== body.class_id || context?.material_id !== body.material_id)) { send(409, {}); return true; }
            context = { class_id: room.id, material_id: material.id, subject_name: room.subject, material_title: material.title };
          }
          if (context && !materials.some((item) => item.id === context.material_id && item.class_id === context.class_id && item.published)) { send(404, {}); return true; }
          if (body.session_id && !session) {
            send(404, {});
          } else {
            if (session?.ended) session = undefined;
            if (!session) {
              const now = new Date().toISOString();
              session = {
                id: `30000000-0000-4000-8000-${String(chatSerial++).padStart(12, "0")}`,
                title: text.slice(0, 64),
                subject_id: body.subject_id || null,
                started_at: now,
                turns: [],
                ended: false,
                ended_at: null,
                context,
              };
              sessions.set(session.id, session);
            }
            const now = new Date().toISOString();
            const reply = tutorReply(text);
            const sources = context ? [{ source: context.material_title, title: context.material_title, class_id: context.class_id, material_id: context.material_id, section_title: "Materi kelas" }] : [];
            session.turns.push({ role: "student", text, intent: "unknown", timestamp: now });
            session.turns.push({ role: "tutor", text: reply, intent: "tutoring", timestamp: new Date().toISOString(), sources });
            send(200, {
              session_id: session.id,
              text: reply,
              intent: "tutoring",
              next_action: "respond",
              sources,
              context,
              latency_ms: 42,
              quiz_progress: null,
            });
          }
        }
      } else if (
        parts[1] === "sessions" &&
        parts[2] &&
        parts.length === 3 &&
        req.method === "GET"
      ) {
        const session = sessions.get(parts[2]);
        if (!session) send(404, {});
        else send(200, { ...sessionSummary(session), turns: session.turns });
      } else if (
        parts[1] === "sessions" &&
        parts[2] &&
        parts.length === 3 &&
        req.method === "DELETE"
      ) {
        if (!sessions.delete(parts[2])) send(404, {});
        else send(204);
      } else if (
        parts[1] === "sessions" &&
        parts[2] &&
        parts[3] === "end" &&
        req.method === "POST"
      ) {
        const session = sessions.get(parts[2]);
        if (!session) send(404, {});
        else {
          if (session.ended) {
            send(404, {});
            return true;
          }
          session.ended = true;
          session.ended_at = new Date().toISOString();
          send(204);
        }
      } else {
        send(404, {});
      }
      return true;
    }
    if (!url.pathname.startsWith("/classes")) return false;
    // Only the seeded teacher/student are members in this read/learn fixture.
    const member = user.id === "test-student" || user.id === "test-teacher";
    const detail = (c) => ({
      ...c,
      material_count: materials.filter((m) => m.class_id === c.id).length,
    });
    if (url.pathname === "/classes/teacher/materials" && req.method === "GET") {
      send(user.role === "teacher" ? 200 : 403, user.role !== "teacher" ? {} : materials.map(m => ({ ...metadata(m),
        class_name: classes.find(c => c.id === m.class_id).name, subject: classes.find(c => c.id === m.class_id).subject, is_archived: false })));
    } else if (url.pathname === "/classes/student/materials" && req.method === "GET") {
      send(
        user.role === "student" ? 200 : 403,
        user.role !== "student"
          ? {}
          : !member
            ? []
            : materials.filter((m) => m.published).map((m) => ({
                ...metadata(m),
                class_name: classes.find((c) => c.id === m.class_id).name,
                subject: classes.find((c) => c.id === m.class_id).subject,
                progress: state(user, m.id),
              })),
      );
    } else if (url.pathname === "/classes" && req.method === "GET") {
      send(200, member ? classes.map(detail) : []);
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      const room = classes.find((c) => c.id === parts[1]);
      const material = materials.find(
        (m) => m.id === parts[3] && m.class_id === room?.id,
      );
      if (!member || !room) send(404, {});
      else if (parts[2] === "imports" && req.method === "GET") {
        if (user.role !== "teacher") send(403, {});
        else if (!parts[3]) send(200, [...imports.values()].filter(record => record.class_id === room.id));
        else send(imports.has(parts[3]) ? 200 : 404, imports.get(parts[3]) || {});
      }
      else if (parts.length === 5 && parts[4] === "concepts" && material && req.method === "GET") {
        send(user.role === "teacher" ? 200 : 403, { material_id: material.id, content_version: material.content_version, mapping_version: 0, subject_id: null, concepts: [] });
      }
      else if (parts[2] === "materials" && parts[3] === "import" && req.method === "POST") {
        if (user.role !== "teacher") send(403, {});
        else if (validateMaterialFile(body.file)) send(422, { detail: validateMaterialFile(body.file) });
        else {
          const record = { import_id: randomUUID(), job_id: randomUUID(), class_id: room.id, filename: body.file.name, state: "complete", preview: { preview_type: "material", filename: body.file.name, title: body.file.name.replace(/\.[^.]+$/, ""), content: body.file.content || "Materi contoh fixture. Pecahan adalah bagian dari keseluruhan.", warnings: ["Pratinjau ini memakai data uji lokal."] } };
          imports.set(record.import_id, record); send(202, record);
        }
      }
      else if (parts.length === 3 && parts[2] === "materials" && req.method === "POST") {
        if (user.role !== "teacher") send(403, {});
        else {
          const next = { id: `20000000-0000-4000-8000-${String(materialSerial++).padStart(12, "0")}`, class_id: room.id, title: body.title, content: body.content, published: Boolean(body.published), source_filename: body.source_filename || null, rag_status: "ready", rag_error: null, n_chunks: 1, content_version: 1, indexed_version: 1, created_at: new Date().toISOString() };
          materials.push(next);
          send(201, metadata(next));
        }
      }
      else if (parts.length === 4 && parts[2] === "materials" && material && req.method === "PUT") {
        if (user.role !== "teacher") send(403, {});
        else { Object.assign(material, body); material.content_version += 1; material.indexed_version = material.content_version; send(200, metadata(material)); }
      }
      else if (parts.length === 5 && parts[4] === "index" && material && req.method === "POST") {
        if (user.role !== "teacher") send(403, {});
        else if (!material.published) send(409, { detail: "Terbitkan materi terlebih dahulu." });
        else { Object.assign(material, { rag_status: "ready", indexed_version: material.content_version, n_chunks: 2 }); send(202, metadata(material)); }
      }
      else if (parts.length === 2 && req.method === "GET")
        send(200, {
          ...detail(room),
          materials: materials
            .filter((m) => m.class_id === room.id && (user.role === "teacher" || m.published))
            .map(metadata),
          members: [],
        });
      else if (
        parts.length === 4 &&
        parts[2] === "materials" &&
        material && (user.role === "teacher" || material.published) &&
        req.method === "GET"
      )
        send(200, { ...material, progress: state(user, material.id) });
      else if (
        parts.length === 5 &&
        parts[2] === "materials" &&
        parts[4] === "progress" &&
        material &&
        req.method === "PATCH"
      ) {
        if (user.role !== "student") send(403, {});
        else if (
          Object.entries(body).some(
            ([key, value]) =>
              !["completed", "bookmarked"].includes(key) ||
              typeof value !== "boolean",
          )
        )
          send(422, {});
        else {
          const previous = state(user, material.id);
          const next = {
            ...previous,
            ...body,
            completed_at:
              body.completed === false
                ? null
                : body.completed === true
                  ? previous.completed_at || new Date().toISOString()
                  : previous.completed_at,
          };
          progress.set(`${user.id}:${material.id}`, next);
          send(200, next);
        }
      } else send(404, {});
    }
    return true;
  };
}
