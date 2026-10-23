"use client";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { UiText, useI18n, UiDate } from "@/components/language-provider";


import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  FileCheck2,
  HelpCircle,
  Sparkles,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { QuizRichEditor } from "./quiz-rich-editor";
import type { Classroom, TeacherMaterial } from "@/lib/class-types";
import { editorialRequest } from "@/lib/editorial-client";
import { createQuizSubmissionId } from "@/lib/quiz-submission.mjs";
import {
  eventLabel,
  quizState,
  type Assignment,
  type EditableQuestion,
  type QuizDraft,
  type Reviewer,
  type Subject,
} from "@/lib/editorial-types";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import { Badge } from "./ui";
import { LoadingStatus } from "./loading-feedback";
import { Spinner } from "./ui/spinner";
import { RefreshButton } from "./refresh-button";
import "@/styles/editorial.css";

const blankQuestion = (order_index: number): EditableQuestion => ({
  order_index,
  prompt: "",
  narration: "",
  options: [
    { id: "a", label: "" },
    { id: "b", label: "" },
  ],
  correct_option_id: "a",
  explanation: "",
  difficulty: "medium",
  concept_id: null,
});
const editable = (draft: QuizDraft): EditableQuestion[] =>
  draft.version.questions.map((q) => ({
    order_index: q.order_index,
    prompt: q.prompt,
    narration: q.narration,
    options: q.options,
    correct_option_id: q.correct_option_id,
    explanation: q.explanation,
    difficulty: q.difficulty,
    concept_id: q.concept_id,
  }));

const operationLabels: Record<string, string> = {
  propose: "Menyusun usulan soal…", save: "Menyimpan revisi kuis…", subject: "Menyimpan mata pelajaran…",
  publish: "Menerbitkan kuis…", assign: "Menyiapkan penugasan…", reviewer: "Memperbarui peninjau…",
  "submit-review": "Mengajukan kuis untuk peninjauan…", approve: "Menyimpan hasil peninjauan…", reject: "Menyimpan hasil peninjauan…",
};

export function QuizWorkspace({
  initial = null,
  subjects = [],
  classes = [],
  reviewers = [],
  mode = "owner",
  admin = false,
  materials = [],
}: {
  initial?: QuizDraft | null;
  subjects?: Subject[];
  classes?: Classroom[];
  reviewers?: Reviewer[];
  mode?: "owner" | "review";
  admin?: boolean;
  materials?: TeacherMaterial[];
}) {
  const { t, language } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [title, setTitle] = useState(initial?.version.title ?? "");
  const [description, setDescription] = useState(
    initial?.version.description ?? "",
  );
  const [subjectId, setSubjectId] = useState(
    initial?.version.subject_id ?? subjects[0]?.id ?? "",
  );
  const subjectRows = subjects;
  const [items, setItems] = useState<EditableQuestion[]>(
    initial ? editable(initial) : [blankQuestion(1)],
  );
  const [release, setRelease] = useState<"after_submission" | "after_due">(
    initial?.version.release_policy ?? "after_submission",
  );
  const [reviewer, setReviewer] = useState(initial?.version.reviewer_id ?? "");
  const [note, setNote] = useState("");
  const [classId, setClassId] = useState(
    classes.find((c) => !c.is_archived)?.id ?? "",
  );
  const [opens, setOpens] = useState(
    initial?.assignments?.[0]?.opens_at
      ? new Date(initial.assignments[0].opens_at).toISOString().slice(0, 16)
      : "",
  );
  const [due, setDue] = useState(
    initial?.assignments?.[0]?.due_at
      ? new Date(initial.assignments[0].due_at).toISOString().slice(0, 16)
      : "",
  );
  const [dirty, setDirty] = useState(!initial);
  const [proposalMaterial, setProposalMaterial] = useState("");
  const [proposalCount, setProposalCount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const owner = mode === "owner";
  const state = draft?.version.state ?? "draft";
  const action = () => ({
    version_id: draft!.version.id,
    expected_review_revision: draft!.version.review_revision,
  });

  function accept(next: QuizDraft) {
    setDraft(next);
    setTitle(next.version.title);
    setDescription(next.version.description);
    setSubjectId(next.version.subject_id);
    setRelease(next.version.release_policy);
    setItems(editable(next));
    setReviewer(next.version.reviewer_id ?? "");
    setDirty(false);
  }
  async function run(
    heading: string,
    text: string,
    work: () => Promise<void>,
    success: string,
    operation = "update",
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (
        !(await confirmAction({
          title: heading,
          text,
          confirmText: "Ya, lanjutkan",
        }))
      )
        return;
      setBusy(true);
      setBusyAction(operation);
      setBusyLabel(operationLabels[operation] ?? "Memperbarui kuis…");
      setError("");
      await work();
      setMessage(success);
      await notifyResult(success);
    } catch (caught) {
      const text =
        caught instanceof Error ? caught.message : "Perubahan belum tersimpan.";
      setError(text);
      await notifyResult(text, true);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  function change(index: number, patch: Partial<EditableQuestion>) {
    setItems((rows) =>
      rows.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    );
    setDirty(true);
  }
  function move(index: number, direction: number) {
    setItems((rows) => {
      const next = [...rows];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next.map((q, i) => ({ ...q, order_index: i + 1 }));
    });
    setDirty(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(
      "Simpan revisi kuis?",
      "Isi soal disimpan sebagai revisi baru. Revisi yang telah ditugaskan tetap utuh.",
      async () => {
        const payload = {
          subject_id: subjectId,
          title,
          description,
          release_policy: release,
          questions: items,
        };
        const next = await editorialRequest<QuizDraft>(
          draft ? `/teacher/quizzes/${draft.id}` : "/teacher/quizzes",
          draft ? "PATCH" : "POST",
          {
            ...payload,
            ...(draft ? { expected_version: draft.current_version } : {}),
          },
        );
        accept(next);
        if (!draft) router.replace(`/guru/kuis/${next.id}`);
      },
      "Draf kuis tersimpan. Anda dapat langsung menerbitkan kuis untuk dibagikan ke kelas.",
      "save",
    );
  }
  async function transition(
    name: string,
    heading: string,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    await run(
      heading,
      text,
      async () => {
        accept(
          await editorialRequest<QuizDraft>(
            `/teacher/quizzes/${draft!.id}/${name}`,
            "POST",
            { ...action(), ...extra },
          ),
        );
      },
      "Status kuis berhasil diperbarui.",
      name,
    );
  }

  return (
    <>
      <LoadingStatus active={busy} label={busyLabel} />
      <div className="editorial-status-bar">
        <Badge active={state !== "rejected"}>{<UiText>{quizState[state]}</UiText>}</Badge>
        <span className="editorial-status-meta"><UiText>{"Revisi "}</UiText>{draft?.current_version ?? 1} · {items.length}<UiText>{" soal"}</UiText></span>
        <span className={`editorial-status-save ${dirty ? "editorial-unsaved" : "editorial-saved"}`}>
          <span className="editorial-status-dot" aria-hidden="true" />
          {dirty ? <UiText>{"Perubahan belum disimpan"}</UiText> : <UiText>{"Isi sudah tersimpan"}</UiText>}
        </span>
      </div>
      {error && (
        <p className="editorial-error" role="alert">
          {t(error)}{" "}
          <RefreshButton label="Muat ulang halaman" size="sm" disabled={busy} />
        </p>
      )}
      <p className="editorial-live" role="status" aria-live="polite">
        {message}
      </p>
      <div className="editorial-grid">
        <div className="editorial-main">
          {owner ? (
            <form onSubmit={save} className="editorial-form">
              <section className="panel editorial-section">
                <div className="editorial-section-title">
                  <span className="editorial-number">01</span>
                  <div>
                    <h2><UiText>{"Identitas kuis"}</UiText></h2>
                    <p><UiText>{"Berikan konteks yang jelas sebelum siswa mulai."}</UiText></p>
                  </div>
                </div>
                <section className="editorial-proposal" aria-label={t("Usulan soal dari materi")}>
                  <div className="editorial-proposal-header">
                    <div className="editorial-proposal-icon">
                      <Sparkles size={20} aria-hidden="true" />
                    </div>
                    <div>
                      <h3><UiText>{"Usulkan soal dari materi"}</UiText></h3>
                      <p><UiText>{"Soal yang dibuat tetap perlu Anda tinjau sebelum diajukan untuk peninjauan dan diterbitkan."}</UiText></p>
                    </div>
                  </div>
                  <div className="editorial-proposal-body">
                    <div className="quiz-settings">
                      <label className="field">
                        <UiText>{"Materi sumber"}</UiText>
                        <NativeSelect value={proposalMaterial} onChange={(event) => setProposalMaterial(event.target.value)} disabled={busy}>
                          <option value=""><UiText>{"Pilih materi"}</UiText></option>
                          {materials.filter((row) => !row.is_archived).map((row) => (
                            <option key={row.id} value={row.id}>{row.class_name} · {row.title}</option>
                          ))}
                        </NativeSelect>
                      </label>
                      <label className="field editorial-proposal-count">
                        <UiText>{"Jumlah soal"}</UiText>
                        <NativeSelect value={proposalCount} onChange={(event) => setProposalCount(event.target.value)} disabled={busy}>
                          <option value="3">3</option>
                          <option value="5">5</option>
                          <option value="10">10</option>
                        </NativeSelect>
                      </label>
                    </div>
                    <button
                      type="button"
                      className="button secondary editorial-proposal-button"
                      disabled={busy || !proposalMaterial}
                      onClick={() => {
                        const source = materials.find((row) => row.id === proposalMaterial);
                        if (!source) return;
                        void run(
                          "Ganti soal dengan usulan dari materi?",
                          "Soal di editor akan diganti. Tinjau semua pertanyaan, pilihan, dan pembahasannya sebelum menyimpan.",
                          async () => {
                            const proposed = await editorialRequest<{ questions: EditableQuestion[] }>(
                              "/teacher/quizzes/propose",
                              "POST",
                              { class_id: source.class_id, material_id: source.id, n_questions: Number(proposalCount), language }
                            );
                            setItems(proposed.questions);
                            if (!title.trim()) setTitle(source.title);
                            setDirty(true);
                          },
                          "Usulan soal siap ditinjau. Belum diterbitkan ke siswa.",
                          "propose"
                        );
                      }}
                    >
                      {busy && busyAction === "propose" ? <Spinner /> : <Sparkles size={17} aria-hidden="true" />}
                      <UiText>{"Buat usulan soal"}</UiText>
                    </button>
                  </div>
                </section>
                <label className="field"><UiText>{"Judul kuis"}</UiText><Input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setDirty(true);
                    }}
                    required
                    maxLength={200}
                    disabled={busy}
                    placeholder={t("Contoh: Memahami pecahan di sekitar kita")}
                  />
                </label>
                <label className="field"><UiText>{"Deskripsi"}</UiText><Textarea
                    rows={3}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDirty(true);
                    }}
                    maxLength={2000}
                    disabled={busy}
                    placeholder={t("Apa yang akan dipelajari siswa?")}
                  />
                </label>
                <div className="editorial-two-fields">
                  <label className="field"><UiText>{"Mata pelajaran"}</UiText><NativeSelect
                      value={subjectId}
                      onChange={(e) => {
                        setSubjectId(e.target.value);
                        setItems((qs) =>
                          qs.map((q) => ({ ...q, concept_id: null })),
                        );
                        setDirty(true);
                      }}
                      required
                      disabled={busy}
                    >
                      <option value=""><UiText>{"Pilih mata pelajaran"}</UiText></option>
                      {subjectRows.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="field"><UiText>{"Pembahasan untuk siswa"}</UiText><NativeSelect
                      value={release}
                      onChange={(e) => {
                        setRelease(e.target.value as typeof release);
                        setDirty(true);
                      }}
                      disabled={busy}
                    >
                      <option value="after_submission"><UiText>{"Setelah jawaban dikirim"}</UiText></option>
                      <option value="after_due"><UiText>{"Setelah batas pengumpulan (Deadline)"}</UiText></option>
                    </NativeSelect>
                  </label>
                </div>

                <div className="editorial-deadline-box">
                  <div className="editorial-deadline-header">
                    <div className="editorial-deadline-icon">
                      <CalendarClock size={20} aria-hidden="true" />
                    </div>
                    <div>
                      <h4 className="editorial-deadline-title">
                        <UiText>{"Batas Waktu Pengumpulan (Deadline)"}</UiText>
                      </h4>
                      <p className="editorial-deadline-subtitle">
                        {release === "after_due" ? (
                          <UiText>{"Wajib diatur. Pembahasan dan kunci jawaban otomatis terbuka untuk siswa setelah melewati tenggat waktu ini."}</UiText>
                        ) : (
                          <UiText>{"Tentukan batas akhir pengerjaan kuis bagi siswa. Kosongkan jika kuis terbuka tanpa batas waktu."}</UiText>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="editorial-deadline-inputs">
                    <label className="field">
                      <span className="editorial-field-label">
                        <UiText>{"Tenggat waktu pengumpulan (waktu perangkat)"}</UiText>
                        {release === "after_due" && <span className="field-required">*</span>}
                      </span>
                      <Input
                        type="datetime-local"
                        value={due}
                        onChange={(e) => {
                          setDue(e.target.value);
                          setDirty(true);
                        }}
                        required={release === "after_due"}
                        disabled={busy}
                        className="editorial-deadline-input"
                      />
                    </label>
                  </div>
                  {due && (
                    <div className="editorial-deadline-badge">
                      <Clock size={14} aria-hidden="true" />
                      <span>
                        <UiText>{"Tenggat: "}</UiText>
                        <strong>
                          {new Date(due).toLocaleString(language === "en" ? "en-US" : "id-ID", {
                            dateStyle: "full",
                            timeStyle: "short",
                          })}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              </section>
              <section className="panel editorial-section">
                <div className="editorial-section-title">
                  <span className="editorial-number">02</span>
                  <div>
                    <h2><UiText>{"Soal & pembahasan"}</UiText></h2>
                    <p><UiText>{"Pilihan ganda yang ringkas, jelas, dan nyaman dibacakan."}</UiText></p>
                  </div>
                </div>
                {items.map((q, index) => (
                  <div className="editorial-question" key={index}>
                    <div className="editorial-question-header">
                      <div className="editorial-question-badge-group">
                        <span className="editorial-question-badge">
                          <UiText>{"Soal "}</UiText>{index + 1}
                        </span>
                        <span className={`editorial-difficulty-badge is-${q.difficulty}`}>
                          {q.difficulty === "easy" ? (
                            <UiText>{"Mudah"}</UiText>
                          ) : q.difficulty === "hard" ? (
                            <UiText>{"Sulit"}</UiText>
                          ) : (
                            <UiText>{"Sedang"}</UiText>
                          )}
                        </span>
                      </div>
                      <div className="editorial-question-tools">
                        <button
                          type="button"
                          className="editorial-icon-button"
                          title={t("Naikkan urutan soal")}
                          aria-label={t("Naikkan soal {number}", { number: index + 1 })}
                          disabled={busy || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="editorial-icon-button"
                          title={t("Turunkan urutan soal")}
                          aria-label={t("Turunkan soal {number}", { number: index + 1 })}
                          disabled={busy || index === items.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="editorial-icon-button editorial-delete"
                          title={t("Hapus soal ini")}
                          aria-label={t("Hapus soal {number}", { number: index + 1 })}
                          disabled={busy || items.length === 1}
                          onClick={async () => {
                            if (
                              await confirmAction({
                                title: t("Hapus soal {number}?", { number: index + 1 }),
                                text: "Perubahan ini diterapkan pada revisi yang sedang Anda edit.",
                                destructive: true,
                              })
                            ) {
                              setItems((rows) =>
                                rows
                                  .filter((_, i) => i !== index)
                                  .map((item, i) => ({
                                    ...item,
                                    order_index: i + 1,
                                  })),
                              );
                              setDirty(true);
                            }
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <QuizRichEditor
                      id={`prompt-${index}`}
                      label={<UiText>{"Pertanyaan"}</UiText>}
                      value={q.prompt}
                      onChange={(next) => change(index, { prompt: next })}
                      required
                      maxLength={4000}
                      disabled={busy}
                      placeholder={t("Tuliskan pertanyaan soal... Gunakan toolbar untuk rumus dan notasi ilmiah.")}
                    />

                    <div className="editorial-option-help">
                      <HelpCircle size={16} aria-hidden="true" />
                      <span><UiText>{"Pilih satu kunci jawaban. Kunci hanya terlihat oleh guru dan peninjau sebelum pembahasan dirilis."}</UiText></span>
                    </div>

                    <fieldset className="editorial-options">
                      <legend><UiText>{"Kunci dan pilihan soal "}</UiText>{index + 1}</legend>
                      {q.options.map((option, oi) => {
                        const isCorrect = q.correct_option_id === option.id;
                        return (
                          <div
                            className={`editorial-option ${isCorrect ? "is-correct" : ""}`}
                            key={option.id}
                          >
                            <label className="editorial-key">
                              <input
                                type="radio"
                                name={`correct-${index}`}
                                checked={isCorrect}
                                onChange={() =>
                                  change(index, { correct_option_id: option.id })
                                }
                                disabled={busy}
                                aria-label={t("Kunci jawaban pilihan {letter} soal {number}", { letter: String.fromCharCode(65 + oi), number: index + 1 })}
                              />
                              <span className="editorial-option-letter">{String.fromCharCode(65 + oi)}</span>
                            </label>
                            <label className="field">
                              <span className="sr-only"><UiText>{"Isi pilihan "}</UiText>{String.fromCharCode(65 + oi)}<UiText>{" soal"}</UiText>{" "}
                                {index + 1}
                              </span>
                              <Input
                                value={option.label}
                                required
                                maxLength={1000}
                                disabled={busy}
                                placeholder={`Pilihan ${String.fromCharCode(65 + oi)}`}
                                onChange={(e) =>
                                  change(index, {
                                    options: q.options.map((o) =>
                                      o.id === option.id
                                        ? { ...o, label: e.target.value }
                                        : o,
                                    ),
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="editorial-option-delete"
                              aria-label={t("Hapus pilihan {letter} soal {number}", { letter: String.fromCharCode(65 + oi), number: index + 1 })}
                              disabled={busy || q.options.length <= 2}
                              onClick={async () => {
                                if (
                                  await confirmAction({
                                    title: "Hapus pilihan jawaban?",
                                    text: "Jika pilihan ini adalah kunci, pilih kembali kunci jawaban yang benar.",
                                    destructive: true,
                                  })
                                ) {
                                  const options = q.options.filter(
                                    (o) => o.id !== option.id,
                                  );
                                  change(index, {
                                    options,
                                    correct_option_id:
                                      q.correct_option_id === option.id
                                        ? options[0].id
                                        : q.correct_option_id,
                                  });
                                }
                              }}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </fieldset>
                    <button
                      type="button"
                      className="editorial-add-option-btn"
                      disabled={busy || q.options.length >= 6}
                      onClick={() =>
                        change(index, {
                          options: [
                            ...q.options,
                            { id: createQuizSubmissionId(), label: "" },
                          ],
                        })
                      }
                    >
                      <Plus size={15} aria-hidden="true" /><UiText>{"Tambah pilihan"}</UiText>
                    </button>

                    <QuizRichEditor
                      id={`explanation-${index}`}
                      label={<UiText>{"Pembahasan"}</UiText>}
                      value={q.explanation}
                      onChange={(next) => change(index, { explanation: next })}
                      maxLength={4000}
                      disabled={busy}
                      placeholder={t("Jelaskan alasan jawaban benar dengan bahasa sederhana. Gunakan toolbar untuk rumus.")}
                    />

                    <div className="editorial-two-fields">
                      <label className="field"><UiText>{"Tingkat kesulitan"}</UiText><NativeSelect
                          value={q.difficulty}
                          onChange={(e) =>
                            change(index, {
                              difficulty: e.target
                                .value as EditableQuestion["difficulty"],
                            })
                          }
                          disabled={busy}
                        >
                          <option value="easy"><UiText>{"Mudah"}</UiText></option>
                          <option value="medium"><UiText>{"Sedang"}</UiText></option>
                          <option value="hard"><UiText>{"Sulit"}</UiText></option>
                        </NativeSelect>
                      </label>
                      <span className="editorial-help"><UiText>{"Nilai setiap soal berbobot sama. Belum ada batas waktu per soal."}</UiText></span>
                    </div>
                    <details className="editorial-details">
                      <summary><UiText>{"Narasi alternatif untuk audio"}</UiText></summary>
                      <label className="field"><UiText>{"Narasi soal"}</UiText><Textarea
                          rows={3}
                          maxLength={6000}
                          value={q.narration}
                          onChange={(e) =>
                            change(index, { narration: e.target.value })
                          }
                          disabled={busy}
                          placeholder={t("Opsional. Tulis simbol atau rumus menjadi kalimat yang mudah didengar.")}
                        />
                      </label>
                    </details>
                  </div>
                ))}
                <button
                  type="button"
                  className="editorial-add-question-btn"
                  disabled={busy || items.length >= 20}
                  onClick={() => {
                    setItems((rows) => [
                      ...rows,
                      blankQuestion(rows.length + 1),
                    ]);
                    setDirty(true);
                  }}
                >
                  <Plus size={17} aria-hidden="true" /><UiText>{" Tambah soal"}</UiText>{" "}
                  <span className="muted">{items.length}/20</span>
                </button>
              </section>
              <div className="editorial-save-bar">
                <span>
                  {dirty
                    ? <UiText>{"Simpan perubahan sebelum mengajukan peninjauan."}</UiText>
                    : <UiText>{"Anda dapat menyiapkan revisi berikutnya kapan saja."}</UiText>}
                </span>
                <button
                  className="button primary"
                  disabled={busy || !subjectId || !dirty}
                >
                  {busy && busyAction === "save" ? <Spinner /> : <Save size={17} aria-hidden="true" />}{" "}
                  {busy && busyAction === "save"
                    ? <UiText>{"Menyimpan…"}</UiText>
                    : draft
                      ? <UiText>{"Simpan revisi baru"}</UiText>
                      : <UiText>{"Simpan draf"}</UiText>}
                </button>
              </div>
            </form>
          ) : (
            <section className="panel editorial-section">
              <div className="editorial-section-title">
                <FileCheck2 size={24} aria-hidden="true" />
                <div>
                  <h2><UiText>{"Pratinjau revisi "}</UiText>{draft?.current_version}</h2>
                  <p>
                    {description ||
                      <UiText>{"Periksa pertanyaan, kunci, dan pembahasan sebelum mengambil keputusan."}</UiText>}
                  </p>
                </div>
              </div>
              {draft?.version.questions.map((q) => (
                <article className="editorial-review-question" key={q.id}>
                  <span className="editorial-kicker"><UiText>{"SOAL "}</UiText>{q.order_index} ·{" "}
                    {q.difficulty === "easy"
                      ? <UiText>{"MUDAH"}</UiText>
                      : q.difficulty === "hard"
                        ? <UiText>{"SULIT"}</UiText>
                        : <UiText>{"SEDANG"}</UiText>}
                  </span>
                  <h3>{q.prompt}</h3>
                  <ol type="A" className="editorial-review-options">
                    {q.options.map((o) => (
                      <li
                        key={o.id}
                        className={
                          o.id === q.correct_option_id ? "correct" : ""
                        }
                      >
                        {o.label}
                        {o.id === q.correct_option_id && (
                          <span>
                            <Check size={15} aria-hidden="true" /><UiText>{"Kunci jawaban"}</UiText></span>
                        )}
                      </li>
                    ))}
                  </ol>
                  <p>
                    <strong><UiText>{"Pembahasan:"}</UiText></strong>{" "}
                    {q.explanation || <UiText>{"Belum ditulis."}</UiText>}
                  </p>
                  {q.narration && (
                    <p>
                      <strong><UiText>{"Narasi:"}</UiText></strong> {q.narration}
                    </p>
                  )}
                </article>
              ))}
            </section>
          )}
          {owner && draft && (
            <section className="panel editorial-section">
              <div className="editorial-section-title">
                <span className="editorial-number">03</span>
                <div>
                  <h2><UiText>{"Penugasan kelas"}</UiText></h2>
                  <p><UiText>{"Versi terbit dibagikan ke siswa yang menjadi anggota kelas."}</UiText></p>
                </div>
              </div>
              {state === "published" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      "Tugaskan kuis ke kelas?",
                      "Siswa mendapat satu percobaan. Periksa kelas dan jadwal sebelum melanjutkan.",
                      async () => {
                        const assigned = await editorialRequest<Assignment>(
                          `/teacher/quizzes/${draft.id}/assignments`,
                          "POST",
                          {
                            version_id: draft.version.id,
                            class_id: classId,
                            opens_at: opens
                              ? new Date(opens).toISOString()
                              : null,
                            due_at: due ? new Date(due).toISOString() : null,
                          },
                        );
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                assignments: [assigned, ...current.assignments],
                              }
                            : current,
                        );
                      },
                      "Kuis berhasil ditugaskan ke kelas.",
                      "assign",
                    );
                  }}
                  className="editorial-assignment-form"
                >
                  <label className="field"><UiText>{"Kelas tujuan"}</UiText><NativeSelect
                      required
                      value={classId}
                      onChange={(e) => setClassId(e.target.value)}
                      disabled={busy || dirty}
                    >
                      <option value=""><UiText>{"Pilih kelas aktif"}</UiText></option>
                      {classes
                        .filter((c) => !c.is_archived)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.subject}
                          </option>
                        ))}
                    </NativeSelect>
                  </label>
                  <div className="editorial-two-fields">
                    <label className="field"><UiText>{"Dibuka pada (waktu perangkat)"}</UiText><Input
                        type="datetime-local"
                        value={opens}
                        onChange={(e) => setOpens(e.target.value)}
                        disabled={busy || dirty}
                      />
                    </label>
                    <label className="field"><UiText>{"Batas pengumpulan (waktu perangkat)"}</UiText><Input
                        type="datetime-local"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                        required={release === "after_due"}
                        disabled={busy || dirty}
                      />
                    </label>
                  </div>
                  <p className="editorial-help"><UiText>{"Kosongkan jadwal untuk langsung dibuka tanpa tenggat. Pembahasan setelah tenggat membutuhkan batas pengumpulan."}</UiText></p>
                  <button
                    className="button primary"
                    disabled={busy || dirty || !classId}
                  >
                    {busy && busyAction === "assign" ? <Spinner /> : <Send size={16} aria-hidden="true" />}<UiText>{"Bagikan ke kelas"}</UiText></button>
                  {!classes.some((c) => !c.is_archived) && (
                    <Link className="learning-back" href="/guru/kelas/baru"><UiText>{"Buat kelas aktif terlebih dahulu"}</UiText>{" "}
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </Link>
                  )}
                </form>
              ) : (
                <p className="info-note"><UiText>{"Penugasan tersedia setelah kuis ini diterbitkan."}</UiText></p>
              )}
              <div className="editorial-assignment-list">
                {draft.assignments.map((a) => (
                  <Link
                    key={a.id}
                    className="editorial-assignment-row"
                    href={`/guru/penugasan/${a.id}`}
                  >
                    <span>
                      <strong>{a.class_name}</strong>
                      <small><UiText>{"Revisi "}</UiText>{a.version} ·{" "}
                        {a.is_closed
                          ? <UiText>{"Ditutup"}</UiText>
                          : <><UiText>{"Tenggat: "}</UiText><UiDate value={a.due_at} time empty="Tanpa batas waktu" /></>}
                      </small>
                    </span>
                    <span><UiText>{"Lihat hasil"}</UiText><ArrowUpRight size={17} aria-hidden="true" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="editorial-aside">
          <section className="panel editorial-section editorial-lifecycle">
            <h2><UiText>{"Langkah publikasi"}</UiText></h2>
            <ol className="editorial-lifecycle-stepper">
              {[
                "Tulis dan simpan draf",
                "Terbitkan kuis",
                "Tugaskan ke kelas",
              ].map((label, index) => {
                const isDraftSaved = Boolean(draft && !dirty);
                const isPublished = state === "published";
                const isAssigned = Boolean(draft?.assignments && draft.assignments.length > 0);
                const isDone =
                  index === 0 ? isDraftSaved :
                  index === 1 ? isPublished :
                  isAssigned;
                const isCurrent =
                  index === 0 ? !isDraftSaved :
                  index === 1 ? (isDraftSaved && !isPublished) :
                  (isPublished && !isAssigned);
                return (
                  <li
                    key={label}
                    className={`editorial-step-item ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`}
                  >
                    <span className="editorial-step-circle">
                      {isDone ? <Check size={14} aria-hidden="true" /> : index + 1}
                    </span>
                    <span className="editorial-step-text"><UiText>{label}</UiText></span>
                  </li>
                );
              })}
            </ol>
            {owner ? (
              <div className="editorial-lifecycle-actions">
                {!draft && (
                  <p className="editorial-help">
                    <UiText>{"Simpan draf kuis terlebih dahulu untuk menerbitkan."}</UiText>
                  </p>
                )}
                {draft && state !== "published" && (
                  <>
                    <button
                      className="button primary editorial-publish-btn"
                      type="button"
                      disabled={busy || dirty}
                      onClick={() =>
                        void transition(
                          "publish",
                          "Terbitkan kuis?",
                          "Kuis yang diterbitkan siap dibagikan sebagai penugasan ke kelas siswa.",
                        )
                      }
                    >
                      {busy && busyAction === "publish" ? <Spinner /> : <CheckCircle2 size={17} aria-hidden="true" />}
                      <UiText>{"Terbitkan kuis"}</UiText>
                    </button>
                    {dirty && (
                      <p className="editorial-help">
                        <UiText>{"Simpan perubahan isi sebelum menerbitkan kuis."}</UiText>
                      </p>
                    )}
                  </>
                )}
                {draft && state === "published" && (
                  <div className="editorial-published-box">
                    <CheckCircle2 size={18} className="text-success" aria-hidden="true" />
                    <div>
                      <strong><UiText>{"Kuis telah diterbitkan"}</UiText></strong>
                      <p><UiText>{"Kuis ini aktif dan dapat ditugaskan ke kelas di bawah."}</UiText></p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="editorial-lifecycle-actions">
                <label className="field"><UiText>{"Catatan peninjauan"}</UiText><Textarea
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={2000}
                    disabled={busy || state !== "in_review"}
                    placeholder={t("Wajib diisi jika meminta perbaikan.")}
                  />
                </label>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || state !== "in_review"}
                  onClick={() =>
                    void transition(
                      "approve",
                      "Setujui revisi kuis?",
                      "Pastikan semua kunci dan pembahasan sudah benar. Pemilik tetap harus menerbitkan kuis.",
                      { note },
                    )
                  }
                >
                  {busy && busyAction === "approve" ? <Spinner /> : <CheckCircle2 size={16} aria-hidden="true" />}<UiText>{"Setujui revisi"}</UiText></button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || state !== "in_review" || !note.trim()}
                  onClick={() =>
                    void transition(
                      "reject",
                      "Minta perbaikan kuis?",
                      "Catatan Anda disimpan pada revisi ini agar pemilik dapat memperbaikinya.",
                      { note },
                    )
                  }
                >{busy && busyAction === "reject" && <Spinner />}<UiText>{"Minta perbaikan"}</UiText></button>
                {admin && state === "in_review" && (
                  <details className="editorial-details">
                    <summary><UiText>{"Ganti peninjau"}</UiText></summary>
                    <label className="field"><UiText>{"Peninjau pengganti"}</UiText><NativeSelect
                        value={reviewer}
                        onChange={(e) => setReviewer(e.target.value)}
                        disabled={busy}
                      >
                        <option value=""><UiText>{"Antrean admin"}</UiText></option>
                        {reviewers
                          .filter((r) => r.id !== draft?.teacher_id)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.full_name}
                            </option>
                          ))}
                      </NativeSelect>
                    </label>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={
                        busy || (draft?.version.reviewer_id ?? "") === reviewer
                      }
                      onClick={() =>
                        void transition(
                          "reviewer",
                          "Ganti peninjau revisi ini?",
                          "Akses guru yang meninjau sebelumnya berakhir. Keputusan dari tab lama akan ditolak.",
                          { reviewer_id: reviewer || null },
                        )
                      }
                    >{busy && busyAction === "reviewer" && <Spinner />}<UiText>{"Ganti peninjau"}</UiText></button>
                  </details>
                )}
              </div>
            )}
          </section>
          {draft && (
            <section className="panel editorial-section">
              <h2><UiText>{"Catatan revisi"}</UiText></h2>
              <ul className="editorial-timeline">
                {draft.events.map((event, i) => (
                  <li key={i}>
                    <strong>{t(eventLabel[event.kind] || event.kind)}</strong>
                    <small>{<UiDate value={event.created_at} time empty="Tanpa batas waktu" />}</small>
                    {event.note && <p>{event.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
