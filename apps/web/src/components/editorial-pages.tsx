
import { UiText } from "@/components/language-provider";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  CalendarClock,
  FileCheck2,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { notFound } from "next/navigation";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { editorialBackend, editorialData } from "@/lib/editorial-server";
import { backend } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import { getServerI18n } from "@/lib/server-language";
import type { Classroom, TeacherMaterial } from "@/lib/class-types";
import {
  availabilityLabel,
  quizState,
  scheduleLabel,
  type Assignment,
  type AssignmentAttempt,
  type AssignmentResult,
  type QuizDraft,
  type QuizSummary,
  type Reviewer,
  type Subject,
  type TeacherResults,
} from "@/lib/editorial-types";
import { assignmentAvailability } from "@/lib/editorial-contract.mjs";
import { Badge, Empty, Heading } from "./ui";
import { QuizWorkspace } from "./editorial-workspace";
import { StudentAssignment } from "./student-assignment";
import { AssignmentResults } from "./assignment-results";
import "@/styles/editorial.css";

function pageNumber(value?: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0
    ? Math.min(number, 40000)
    : 0;
}
function Pagination({
  page,
  next,
  path,
  label,
}: {
  page: number;
  next: boolean;
  path: string;
  label: string;
}) {
  return (
    <nav className="editorial-pagination" aria-label={label}>
      {page > 0 && (
        <Link
          className="button secondary small"
          href={`${path}?page=${page - 1}`}
        >
          <ArrowLeft size={16} aria-hidden="true" /><UiText>{"Sebelumnya"}</UiText></Link>
      )}
      <span><UiText>{"Halaman "}</UiText>{page + 1}</span>
      {next && (
        <Link
          className="button secondary small"
          href={`${path}?page=${page + 1}`}
        ><UiText>{"Selanjutnya"}</UiText><ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </nav>
  );
}

export async function TeacherQuizIndex({
  page: raw,
  search: rawSearch,
  status: rawStatus,
}: {
  page?: string;
  search?: string;
  status?: string;
}) {
  const { t } = await getServerI18n();
  const page = pageNumber(raw);
  const search = (rawSearch ?? "").trim().slice(0, 120);
  const status = (rawStatus ?? "").trim();
  const allRows = await editorialData<QuizSummary[]>(
    `/teacher/quizzes?limit=50&offset=${page * 50}`,
    "teacher",
  );

  const rows = allRows.filter((q) => {
    if (search) {
      const s = search.toLowerCase();
      const matchTitle = q.title.toLowerCase().includes(s);
      const matchDesc = (q.description || "").toLowerCase().includes(s);
      if (!matchTitle && !matchDesc) return false;
    }
    if (status && q.state !== status) {
      return false;
    }
    return true;
  });

  const hasActiveFilters = Boolean(search || status);

  return (
    <>
      <Heading
        icon={<BookOpenCheck size={24} aria-hidden="true" />}
        title={<UiText>{"Kuis & penugasan"}</UiText>}
        description={<UiText>{"Dari pertanyaan yang baik, menuju pemahaman yang lebih terarah."}</UiText>}
      >
        <Link className="button primary" href="/teacher/quizzes/new">
          <Plus size={17} aria-hidden="true" /><UiText>{"Buat kuis"}</UiText></Link>
      </Heading>
      <section className="editorial-hero">
        <div>
          <span className="editorial-kicker">
            <BookOpenCheck size={16} aria-hidden="true" /><UiText>{"RUANG UNTUK MEMAHAMI"}</UiText></span>
          <h2><UiText>{"Siapkan. Tinjau. Bagikan."}</UiText></h2>
          <p><UiText>{"Tulis soal dengan pembahasan yang jelas, ajukan peninjauan, lalu bagikan ke kelas. Jawaban dan nilai siswa tersimpan dalam satu alur."}</UiText></p>
        </div>
        <div className="editorial-hero-steps" aria-label={t("Alur kuis")}>
          <span><UiText>{"01 · Draf"}</UiText></span>
          <span><UiText>{"02 · Peninjauan"}</UiText></span>
          <span><UiText>{"03 · Publikasi"}</UiText></span>
          <span><UiText>{"04 · Penugasan"}</UiText></span>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <form className="filters" action="/teacher/quizzes">
        <div className="field search-field">
          <label htmlFor="search" className="sr-only">
            <UiText>{"Cari judul kuis"}</UiText>
          </label>
          <div className="search-input-wrapper">
            <Search size={18} className="search-input-icon" aria-hidden="true" />
            <Input
              name="search"
              id="search"
              defaultValue={search}
              maxLength={120}
              placeholder={t("Cari judul kuis atau pembahasan…")}
              type="search"
              className="search-input-field"
            />
          </div>
        </div>

        <div className="field filter-select-field">
          <label htmlFor="status" className="filter-label">
            <UiText>{"Status:"}</UiText>
          </label>
          <NativeSelect id="status" name="status" defaultValue={status}>
            <option value=""><UiText>{"Semua status"}</UiText></option>
            <option value="draft"><UiText>{"Draf"}</UiText></option>
            <option value="in_review"><UiText>{"Sedang ditinjau"}</UiText></option>
            <option value="approved"><UiText>{"Disetujui"}</UiText></option>
            <option value="published"><UiText>{"Dipublikasikan"}</UiText></option>
            <option value="rejected"><UiText>{"Ditolak"}</UiText></option>
          </NativeSelect>
        </div>

        <button className="button primary search-submit-btn" type="submit">
          <Search size={15} aria-hidden="true" />
          <UiText>{"Cari"}</UiText>
        </button>

        {hasActiveFilters && (
          <Link href="/teacher/quizzes" className="filter-reset-btn">
            <RotateCcw size={14} aria-hidden="true" />
            <UiText>{"Bersihkan filter"}</UiText>
          </Link>
        )}
      </form>

      <div className="learning-section-heading">
        <h2>
          <UiText>{"Kuis Anda"}</UiText>
          <span className="count">{rows.length}</span>
        </h2>
      </div>
      {rows.length ? (
        <div className="editorial-card-grid">
          {rows.map((q) => (
            <Link
              className="panel editorial-card"
              href={`/teacher/quizzes/${q.id}`}
              key={q.id}
            >
              <div className="editorial-card-top">
                <span className="class-symbol">
                  <FileCheck2 size={22} aria-hidden="true" />
                </span>
                <Badge active={q.state !== "rejected"}>
                  {<UiText>{quizState[q.state]}</UiText>}
                </Badge>
              </div>
              <h3>{q.title}</h3>
              <p>
                {q.description ||
                  <UiText>{"Buka kuis untuk menyiapkan soal, pembahasan, dan penugasan."}</UiText>}
              </p>
              <div className="editorial-card-bottom">
                <span><UiText>{"Revisi "}</UiText>{q.current_version}</span>
                <span><UiText>{"Kelola kuis"}</UiText><ArrowUpRight size={17} aria-hidden="true" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : hasActiveFilters ? (
        <section className="panel">
          <Empty title={<UiText>{"Kuis tidak ditemukan"}</UiText>}>
            <div style={{ display: "grid", gap: "1rem", justifyItems: "center" }}>
              <UiText>{"Tidak ada kuis yang sesuai dengan pencarian atau filter yang dipilih."}</UiText>
              <Link href="/teacher/quizzes" className="button secondary">
                <RotateCcw size={15} aria-hidden="true" />
                <UiText>{"Hapus filter"}</UiText>
              </Link>
            </div>
          </Empty>
        </section>
      ) : (
        <section className="panel">
          <Empty title={<UiText>{"Mulai dari satu pertanyaan."}</UiText>}><UiText>{"Buat kuis pilihan ganda, lalu minta peninjauan sebelum membagikannya ke siswa."}</UiText></Empty>
        </section>
      )}
      <Pagination page={page} next={rows.length === 25} path="/teacher/quizzes" label={t("Halaman daftar")} />
    </>
  );
}

export async function TeacherQuizEditor({ id }: { id?: string }) {
  const { token, user } = await requireSession("teacher");
  const [draft, subjects, classes, reviewers, materials] = await Promise.all([
    id
      ? editorialData<QuizDraft>(`/teacher/quizzes/${id}`, "teacher")
      : Promise.resolve(null),
    backend<Subject[]>("/subjects", token),
    backend<Classroom[]>("/classes", token),
    editorialBackend<Reviewer[]>("/quiz-reviewers", token),
    backend<TeacherMaterial[]>("/classes/teacher/materials", token),
  ]);
  if (draft && draft.teacher_id !== user.id) notFound();
  return (
    <>
      <Link className="learning-back" href="/teacher/quizzes">
        <ArrowLeft size={16} aria-hidden="true" /><UiText>{"Semua kuis"}</UiText></Link>
      <Heading
        title={draft?.version.title || <UiText>{"Buat kuis baru"}</UiText>}
        description={<UiText>{"Pertanyaan yang jelas. Peninjauan yang terarah. Pengalaman belajar yang nyaman."}</UiText>}
      />
      <QuizWorkspace
        key={
          draft
            ? `${draft.id}:${draft.current_version}:${draft.version.review_revision}`
            : "new"
        }
        initial={draft}
        subjects={subjects}
        classes={classes}
        reviewers={reviewers}
        materials={materials}
      />
    </>
  );
}

export async function QuizReviewIndex({
  role,
  page: raw,
  search: rawSearch,
}: {
  role: "teacher" | "admin";
  page?: string;
  search?: string;
}) {
  const { t } = await getServerI18n();
  const page = pageNumber(raw),
    base = role === "admin" ? "/admin/quiz-reviews" : "/teacher/quiz-reviews";
  const search = (rawSearch ?? "").trim().slice(0, 120);
  const allRows = await editorialData<QuizSummary[]>(
    `/quiz-reviews?limit=50&offset=${page * 50}`,
    role,
  );

  const rows = allRows.filter((q) => {
    if (search) {
      const s = search.toLowerCase();
      const matchTitle = q.title.toLowerCase().includes(s);
      const matchOwner = (q.owner_name || "").toLowerCase().includes(s);
      if (!matchTitle && !matchOwner) return false;
    }
    return true;
  });

  const hasActiveFilters = Boolean(search);

  return (
    <>
      <Heading
        icon={<FileCheck2 size={24} aria-hidden="true" />}
        title={<UiText>{"Peninjauan kuis"}</UiText>}
        description={
          role === "admin"
            ? <UiText>{"Pastikan pertanyaan dan pembahasan siap membantu siswa belajar."}</UiText>
            : <UiText>{"Tinjau revisi kuis yang dipercayakan kepada Anda."}</UiText>
        }
      />
      <section className="panel editorial-review-intro">
        <ShieldCheck size={27} aria-hidden="true" />
        <div>
          <h2><UiText>{"Satu revisi. Satu keputusan yang jelas."}</UiText></h2>
          <p><UiText>{"Periksa soal, kunci, dan narasi. Persetujuan memberi guru izin untuk menerbitkan revisi tersebut."}</UiText></p>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <form className="filters" action={base}>
        <div className="field search-field">
          <label htmlFor="search" className="sr-only">
            <UiText>{"Cari judul kuis atau nama guru"}</UiText>
          </label>
          <div className="search-input-wrapper">
            <Search size={18} className="search-input-icon" aria-hidden="true" />
            <Input
              name="search"
              id="search"
              defaultValue={search}
              maxLength={120}
              placeholder={t("Cari judul kuis atau nama guru pengunggah…")}
              type="search"
              className="search-input-field"
            />
          </div>
        </div>

        <button className="button primary search-submit-btn" type="submit">
          <Search size={15} aria-hidden="true" />
          <UiText>{"Cari"}</UiText>
        </button>

        {hasActiveFilters && (
          <Link href={base} className="filter-reset-btn">
            <RotateCcw size={14} aria-hidden="true" />
            <UiText>{"Bersihkan filter"}</UiText>
          </Link>
        )}
      </form>

      <div className="learning-section-heading">
        <h2>
          <UiText>{"Antrean peninjauan"}</UiText>
          <span className="count">{rows.length}</span>
        </h2>
      </div>

      {rows.length ? (
        <div className="editorial-card-grid">
          {rows.map((q) => (
            <Link
              key={q.id}
              className="panel editorial-card"
              href={`${base}/${q.id}`}
            >
              <div className="editorial-card-top">
                <FileCheck2 size={23} aria-hidden="true" />
                <Badge><UiText>{"Menunggu peninjauan"}</UiText></Badge>
              </div>
              <h2>{q.title}</h2>
              <p><UiText>{"Disiapkan oleh "}</UiText>{q.owner_name}</p>
              <div className="editorial-card-bottom">
                <span><UiText>{"Revisi "}</UiText>{q.current_version}</span>
                <span><UiText>{"Tinjau"}</UiText><ArrowUpRight size={17} aria-hidden="true" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : hasActiveFilters ? (
        <section className="panel">
          <Empty title={<UiText>{"Kuis tidak ditemukan"}</UiText>}>
            <div style={{ display: "grid", gap: "1rem", justifyItems: "center" }}>
              <UiText>{"Tidak ada kuis dalam antrean peninjauan yang cocok dengan pencarian."}</UiText>
              <Link href={base} className="button secondary">
                <RotateCcw size={15} aria-hidden="true" />
                <UiText>{"Hapus filter"}</UiText>
              </Link>
            </div>
          </Empty>
        </section>
      ) : (
        <section className="panel">
          <Empty title={<UiText>{"Antrean peninjauan sudah bersih."}</UiText>}><UiText>{"Kuis yang menunggu penilaian akan muncul di sini."}</UiText></Empty>
        </section>
      )}
      <Pagination page={page} next={rows.length === 25} path={base} label={t("Halaman daftar")} />
    </>
  );
}

export async function QuizReviewDetail({
  id,
  role,
}: {
  id: string;
  role: "teacher" | "admin";
}) {
  const { token, user } = await requireSession(role);
  const draft = await editorialData<QuizDraft>(`/teacher/quizzes/${id}`, role);
  if (draft.teacher_id === user.id) notFound();
  const reviewers =
    role === "admin"
      ? await editorialBackend<Reviewer[]>("/quiz-reviewers", token)
      : [];
  return (
    <>
      <Link
        className="learning-back"
        href={role === "admin" ? "/admin/quiz-reviews" : "/teacher/quiz-reviews"}
      >
        <ArrowLeft size={16} aria-hidden="true" /><UiText>{"Antrean peninjauan"}</UiText></Link>
      <Heading
        title={draft.version.title}
        description={<UiText>{"Keputusan Anda berlaku untuk revisi yang sedang ditampilkan."}</UiText>}
      />
      <QuizWorkspace
        key={`${draft.id}:${draft.current_version}:${draft.version.review_revision}`}
        initial={draft}
        mode="review"
        admin={role === "admin"}
        reviewers={reviewers}
      />
    </>
  );
}

export async function StudentAssignmentIndex({ page: raw }: { page?: string }) {
  const { t, language } = await getServerI18n();
  const page = pageNumber(raw);
  const rows = await editorialData<Assignment[]>(
    `/student/assignments?limit=25&offset=${page * 25}`,
    "student",
  );
  return (
    <>
      <Heading
        title={<UiText>{"Tugas Siswa"}</UiText>}
        description={<UiText>{"Kerjakan tugas dari gurumu langkah demi langkah. Jawaban tersimpan otomatis."}</UiText>}
      />
      <section className="editorial-hero">
        <div>
          <h2><UiText>{"Satu soal, satu langkah maju."}</UiText></h2>
          <p><UiText>{"Buka penugasan kelas, dengarkan soal jika diperlukan, dan lanjutkan dari jawaban yang sudah tersimpan."}</UiText></p>
        </div>
      </section>
      {rows.length ? (
        <div className="editorial-card-grid student-class-grid">
          {rows.map((a) => {
            const availability = assignmentAvailability(a);
            return (
              <Link
                key={a.id}
                href={`/student/assignments/${a.id}`}
                className="panel editorial-card student-tactile-card"
                aria-label={t("Tugas {title}. Kelas {className}. {count} soal. Status: {status}. {deadline}.", {
                  title: a.title,
                  className: a.class_name,
                  count: a.total_questions,
                  status: t(availabilityLabel[availability]),
                  deadline: a.due_at
                    ? `${t("Tenggat:")} ${scheduleLabel(a.due_at, language === "en" ? "en-US" : "id-ID")}`
                    : t("Tanpa batas pengumpulan"),
                })}
              >
                <div className="editorial-card-top">
                  <span className="class-symbol">
                    <BookOpenCheck size={22} aria-hidden="true" />
                  </span>
                  <Badge
                    active={
                      availability === "open" || availability === "submitted"
                    }
                  >
                    {<UiText>{availabilityLabel[availability]}</UiText>}
                  </Badge>
                </div>
                <h2>{a.title}</h2>
                <p>
                  {a.class_name} · {a.total_questions}<UiText>{" soal"}</UiText></p>
                <div className="editorial-card-schedule">
                  <CalendarClock size={15} aria-hidden="true" />
                  <span>
                    {a.due_at
                      ? t("Tenggat: {date}", { date: scheduleLabel(a.due_at, language === "en" ? "en-US" : "id-ID") })
                      : <UiText>{"Tanpa batas pengumpulan"}</UiText>}
                  </span>
                </div>
                <div className="editorial-card-bottom">
                  <span>
                    {a.score !== null
                      ? `Nilai ${a.score}/100`
                      : "Revisi " + a.version}
                  </span>
                  <span>
                    {availability === "submitted"
                      ? <UiText>{"Lihat hasil"}</UiText>
                      : a.attempt_state === "in_progress"
                        ? <UiText>{"Lanjutkan"}</UiText>
                        : <UiText>{"Buka tugas"}</UiText>}
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <Empty title={<UiText>{"Tugasmu akan muncul di sini."}</UiText>}><UiText>{"Guru akan membagikan kuis setelah kamu terdaftar di kelas."}</UiText></Empty>
        </section>
      )}
      <Pagination page={page} next={rows.length === 25} path="/student/assignments" label={t("Halaman daftar")} />
    </>
  );
}

export async function StudentAssignmentPage({ id }: { id: string }) {
  const { t } = await getServerI18n();
  const assignment = await editorialData<Assignment>(
    `/student/assignments/${id}`,
    "student",
  );
  const [attempt, result] = await Promise.all([
    assignment.attempt_state === "in_progress"
      ? editorialData<AssignmentAttempt>(
          `/student/assignments/${id}/attempt`,
          "student",
        )
      : Promise.resolve(null),
    assignment.attempt_state === "submitted"
      ? editorialData<AssignmentResult>(
          `/student/assignments/${id}/result`,
          "student",
        )
      : Promise.resolve(null),
  ]);
  return (
    <>
      <Link
        className="learning-back student-back-link"
        href="/student/assignments"
        data-voice-menu="assignments"
        aria-label={t("Kembali ke semua tugas dari guru")}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <UiText>{"Semua tugas"}</UiText>
      </Link>
      <Heading
        title={assignment.title}
        description={t("{className}. {count} soal. Revisi {version}.", {
          className: assignment.class_name,
          count: assignment.total_questions,
          version: assignment.version,
        })}
      />
      <StudentAssignment
        key={JSON.stringify([
          id,
          attempt?.revision ?? "new",
          result?.submitted_at ?? "",
          result?.feedback_released ?? false,
          assignment.is_closed,
          assignment.opens_at,
          assignment.due_at,
        ])}
        assignment={assignment}
        initialAttempt={attempt}
        initialResult={result}
      />
    </>
  );
}

export async function TeacherAssignmentPage({ id }: { id: string }) {
  const result = await editorialData<TeacherResults>(
    `/teacher/assignments/${id}/results`,
    "teacher",
  );
  return (
    <>
      <Link className="learning-back" href="/teacher/quizzes">
        <ArrowLeft size={16} aria-hidden="true" /><UiText>{"Semua kuis"}</UiText></Link>
      <Heading
        title={result.assignment.title}
        description={`${result.assignment.class_name} · Hasil penugasan revisi ${result.assignment.version}`}
      />
      <AssignmentResults initial={result} />
    </>
  );
}
