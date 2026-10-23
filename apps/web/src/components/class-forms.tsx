"use client";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

import { UiText, useI18n } from "@/components/language-provider";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, BookOpenCheck, CheckCircle2, Edit3, Eye, FileText, FolderPlus, Plus, Search, UploadCloud, UserPlus, X } from "lucide-react";
import { addMembers, createClass, changeClass, saveMaterial } from "@/app/class-actions";
import { ActionFeedback, useConfirmedAction } from "./action-feedback";
import type { Classroom, Material } from "@/lib/class-types";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import { canChangeMaterialTarget, materialTutorStatus, validateMaterialFile, parseMaterialPageRange, type MaterialSection } from "@/lib/material-flow.mjs";
import type { CurriculumSubject } from "@/lib/concept-types";
import type { MaterialImportRecord } from "@/lib/import-types";
import { MaterialImportHistory } from "./material-import-history";
import { LoadingStatus } from "./loading-feedback";
import { Spinner } from "./ui/spinner";
import { Button } from "./ui/button";
import { RefreshButton } from "./refresh-button";
import { speechOutput } from "@/lib/browser-speech";

import {MaterialRichEditor} from "./material-rich-editor";
import {MaterialRenderer} from "./material-renderer";
import {MaterialSourceReview} from "./material-source-review";
import {legacyMaterialDocument,materialPlainText,validateMaterialDocument} from "@/lib/material-document-adapter.mjs";
import type {MaterialDocument} from "@/lib/material-document-types";

function SubjectPicker({
  subjects,
  value,
  newValue,
  onChange,
  disabled,
}: {
  subjects: CurriculumSubject[];
  value: string;
  newValue: string;
  onChange: (subjectId: string, newSubjectName: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const optionsId = useId();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedExisting = subjects.find((s) => s.id === value);
  const isNew = value === "__new__";
  const isSelected = Boolean(selectedExisting || (isNew && newValue.trim()));
  const displayName = selectedExisting
    ? selectedExisting.name
    : isNew
      ? newValue
      : "";

  const cleanQuery = query.trim().toLowerCase();
  const filtered = subjects.filter((s) =>
    s.name.toLowerCase().includes(cleanQuery),
  );
  const exactMatch = subjects.some(
    (s) => s.name.toLowerCase() === cleanQuery,
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectExisting = (subj: CurriculumSubject) => {
    onChange(subj.id, "");
    setQuery("");
    setIsOpen(false);
  };

  const handleSelectNew = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onChange("__new__", trimmed);
    setQuery("");
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange("", "");
    setQuery("");
    setIsOpen(true);
  };

  return (
    <div className="subject-combobox" ref={containerRef}>
      <input type="hidden" name="subject_id" value={value} />
      <input type="hidden" name="new_subject" value={newValue} />

      {isSelected ? (
        <div className="subject-selected-card">
          <div className="subject-selected-content">
            <span className="subject-selected-icon">
              <BookOpenCheck size={18} aria-hidden="true" />
            </span>
            <div className="subject-selected-text">
              <span className="subject-selected-name">{displayName}</span>
              {isNew && (
                <span className="subject-new-chip">
                  <UiText>{"Mata pelajaran baru"}</UiText>
                </span>
              )}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              className="subject-change-button"
              onClick={handleClear}
              title={t("Ganti mata pelajaran")}
            >
              <X size={15} aria-hidden="true" />
              <UiText>{"Ganti"}</UiText>
            </button>
          )}
        </div>
      ) : (
        <div className="subject-search-container">
          <div className="subject-input-wrapper">
            <Search
              size={17}
              className="subject-input-search-icon"
              aria-hidden="true"
            />
            <input
              type="text"
              className="subject-combobox-input"
              placeholder={t("Ketik untuk mencari atau menambah mata pelajaran...")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              disabled={disabled}
              autoComplete="off"
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={optionsId}
            />
            {query && (
              <button
                type="button"
                className="subject-input-clear-btn"
                onClick={() => setQuery("")}
                aria-label={t("Hapus pencarian")}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {isOpen && (
            <div id={optionsId} className="subject-dropdown-menu" role="listbox">
              {filtered.length > 0 ? (
                <div className="subject-options-group">
                  <div className="subject-dropdown-heading">
                    <UiText>{"Pilih mata pelajaran yang tersedia:"}</UiText>
                  </div>
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="subject-dropdown-item"
                      onClick={() => handleSelectExisting(s)}
                    >
                      <BookOpen
                        size={16}
                        className="subject-item-icon"
                        aria-hidden="true"
                      />
                      <span className="subject-item-name">{s.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="subject-dropdown-empty">
                  <UiText>{"Tidak ada mata pelajaran yang cocok."}</UiText>
                </div>
              )}

              {query.trim().length > 0 && !exactMatch ? (
                <button
                  type="button"
                  className="subject-dropdown-add-btn"
                  onClick={() => handleSelectNew(query)}
                >
                  <Plus size={16} aria-hidden="true" />
                  <span>
                    <UiText>{"Tambah mata pelajaran baru: "}</UiText>
                    <strong>&ldquo;{query.trim()}&rdquo;</strong>
                  </span>
                </button>
              ) : query.trim().length === 0 ? (
                <div className="subject-dropdown-hint">
                  <UiText>{"Ketik nama mata pelajaran jika belum ada di daftar."}</UiText>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ClassForm({ subjects = [] }: { subjects?: CurriculumSubject[] }) {
  const { t } = useI18n();
  const [values, setValues] = useState({
    name: "",
    subjectId: "",
    newSubject: "",
    description: "",
  });
  const [subjectError, setSubjectError] = useState(false);
  const [state, action, pending] = useConfirmedAction(createClass, {
    title: "Buat kelas baru?",
    text: "Kelas akan tersedia untuk Anda. Siswa dapat mengakses setelah ditambahkan sebagai anggota.",
    confirmText: "Ya, buat kelas",
  }, "Sedang memproses pembuatan kelas baru, mohon tunggu sebentar...");

  const handleSubmit = (formData: FormData) => {
    if (!values.subjectId) {
      setSubjectError(true);
      return;
    }
    setSubjectError(false);
    action(formData);
  };

  return (
    <div className="teacher-form-wrapper">
      <form
        action={handleSubmit}
        onReset={(e) => e.preventDefault()}
        className="panel teacher-create-class-card"
      >
        <ActionFeedback state={state} pending={pending} />

        <div className="teacher-form-section">
          <div className="field">
            <label className="field-label" htmlFor="class_name">
              <span className="field-title">
                <FolderPlus size={17} className="field-icon" aria-hidden="true" />
                <UiText>{"Nama kelas"}</UiText>
              </span>
              <span className="field-required">*</span>
            </label>
            <Input
              id="class_name"
              required
              name="name"
              maxLength={120}
              placeholder={t("Contoh: Matematika • Kelas 8A")}
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
            <span className="field-hint">
              <UiText>{"Beri nama yang jelas agar mudah dikenali oleh siswa di beranda kelas."}</UiText>
            </span>
          </div>

          <div className="field">
            <label className="field-label">
              <span className="field-title">
                <BookOpen size={17} className="field-icon" aria-hidden="true" />
                <UiText>{"Mata pelajaran"}</UiText>
              </span>
              <span className="field-required">*</span>
            </label>
            <SubjectPicker
              subjects={subjects}
              value={values.subjectId}
              newValue={values.newSubject}
              onChange={(subjectId, newSubjectName) => {
                setValues({ ...values, subjectId, newSubject: newSubjectName });
                if (subjectId) setSubjectError(false);
              }}
              disabled={pending}
            />
            {subjectError && (
              <p className="subject-error-msg">
                <UiText>{"Pilih atau tambahkan mata pelajaran terlebih dahulu."}</UiText>
              </p>
            )}
            <span className="field-hint">
              <UiText>{"Cari dari kurikulum yang sudah ada atau ketik untuk menambahkan mata pelajaran baru."}</UiText>
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="class_description">
              <span className="field-title">
                <FileText size={17} className="field-icon" aria-hidden="true" />
                <UiText>{"Tentang kelas"}</UiText>
              </span>
              <span className="field-optional">
                <UiText>{"(Opsional)"}</UiText>
              </span>
            </label>
            <Textarea
              id="class_description"
              name="description"
              rows={4}
              maxLength={2000}
              placeholder={t("Apa yang akan dipelajari di kelas ini?")}
              value={values.description}
              onChange={(e) =>
                setValues({ ...values, description: e.target.value })
              }
            />
            <span className="field-hint">
              <UiText>{"Ceritakan cakupan materi, target pembelajaran, atau catatan awal untuk siswa."}</UiText>
            </span>
          </div>
        </div>

        <div className="teacher-form-actions">
          <Link href="/guru/kelas" className="button secondary">
            <UiText>{"Batal"}</UiText>
          </Link>
          <button
            className="button primary"
            disabled={pending || !values.name.trim()}
          >
            {pending ? (
              <>
                <Spinner />
                <UiText>{"Memproses…"}</UiText>
              </>
            ) : (
              <>
                <Plus size={16} aria-hidden="true" />
                <UiText>{"Buat kelas"}</UiText>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

type Candidate = { id: string; full_name: string; username: string };

export function MemberPicker({ classId }: { classId: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [chosen, setChosen] = useState<Candidate[]>([]);
  const [state, action, pending] = useConfirmedAction(addMembers.bind(null, classId), {
    title: "Tambahkan siswa terpilih?",
    text: t("{count} siswa akan mendapat akses ke seluruh materi yang diterbitkan di kelas ini.", { count: chosen.length }),
    confirmText: "Ya, tambahkan",
  });
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.success) { setChosen([]); setResults([]); setQuery(""); }
  }

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const response = await fetch(`/api/classes/${classId}/member-candidates?q=${encodeURIComponent(term)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Pencarian siswa belum berhasil.");
        setResults(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "Pencarian siswa belum berhasil.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [classId, query]);

  const toggle = (row: Candidate) => setChosen(list => list.some(item => item.id === row.id) ? list.filter(item => item.id !== row.id) : [...list, row].slice(0, 50));
  const showResults = query.trim().length >= 2;
  return (
    <form action={action} onReset={(e) => e.preventDefault()} className="member-picker">
      {chosen.map(row => <input key={row.id} type="hidden" name="student_ids" value={row.id} />)}
      <label className="field"><UiText>{"Cari siswa"}</UiText>
        <span className="member-picker-search">
          <Search size={17} aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Ketik nama atau username, minimal 2 huruf")}
            autoCapitalize="none"
            autoComplete="off"
            maxLength={64}
            aria-controls={`member-results-${classId}`}
          />
        </span>
      </label>
      <LoadingStatus active={showResults && searching} label="Mencari siswa…" compact />
      {showResults && <div id={`member-results-${classId}`} className="member-picker-results" role="group" aria-label={t("Hasil pencarian siswa")} aria-busy={searching}>
        {searchError && <p className="alert error-message" role="alert">{t(searchError)}</p>}
        {!searching && !searchError && !results.length && <p className="muted"><UiText>{"Tidak ada siswa aktif yang cocok, atau semua sudah menjadi anggota."}</UiText></p>}
        {!searching && results.map(row => {
          const selected = chosen.some(item => item.id === row.id);
          return <label key={row.id} className={`member-picker-option ${selected ? "is-selected" : ""}`}>
            <input type="checkbox" checked={selected} onChange={() => toggle(row)} />
            <span className="member-avatar" aria-hidden="true">{row.full_name.trim().charAt(0).toUpperCase() || "?"}</span>
            <span className="member-picker-name"><strong>{row.full_name}</strong><small>@{row.username}</small></span>
          </label>;
        })}
      </div>}
      {!!chosen.length && <div className="member-picker-chosen" aria-label={t("Siswa terpilih")}>
        {chosen.map(row => <button type="button" key={row.id} className="member-chip" onClick={() => toggle(row)} aria-label={t("Batalkan pilihan {name}", { name: row.full_name })}>
          {row.full_name}<X size={14} aria-hidden="true" />
        </button>)}
      </div>}
      <button className="button primary" disabled={pending || !chosen.length}>
        {pending ? <Spinner /> : <UserPlus size={17} aria-hidden="true" />}
        {pending ? <UiText>{"Memproses…"}</UiText> : chosen.length ? t("Tambahkan {count} siswa", { count: chosen.length }) : <UiText>{"Pilih siswa dulu"}</UiText>}
      </button>
      <ActionFeedback state={state} pending={pending} />
    </form>
  );
}

export function ClassAction({
  classId,
  mode,
  studentId,
  name,
}: {
  classId: string;
  mode: "add-member" | "remove-member" | "archive" | "restore";
  studentId?: string;
  name?: string;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const labels = {
    "add-member": "Tambahkan siswa",
    "remove-member": "Keluarkan",
    archive: "Arsipkan kelas",
    restore: "Aktifkan kembali",
  };
  const explanations = {
    "add-member": t("Siswa @{username} akan mendapat akses ke seluruh materi yang diterbitkan di kelas ini.", { username }),
    "remove-member": t("{name} akan kehilangan akses ke kelas dan seluruh materinya.", { name: name || t("Siswa") }),
    archive:
      "Kelas disimpan sebagai arsip dan tidak dapat diakses siswa. Anda bisa mengaktifkannya kembali.",
    restore:
      "Seluruh anggota kelas kembali dapat membaca materi yang diterbitkan.",
  };
  const [state, action, pending] = useConfirmedAction(
    changeClass.bind(null, classId),
    {
      title: `${t(labels[mode])}?`,
      text: explanations[mode],
      destructive: mode === "remove-member" || mode === "archive",
    },
  );
  return (
    <form
      action={action}
      onReset={(e) => e.preventDefault()}
      className="class-action"
    >
      <input type="hidden" name="mode" value={mode} />
      {studentId && <input type="hidden" name="studentId" value={studentId} />}
      {mode === "add-member" && (
        <label className="field"><UiText>{"Username siswa"}</UiText><Input
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("Username akun yang sudah terdaftar")}
            required
            minLength={3}
            maxLength={64}
            autoCapitalize="none"
          />
        </label>
      )}
      <button
        disabled={pending}
        className={`button ${mode === "add-member" || mode === "restore" ? "primary" : "secondary"}`}
        aria-label={mode === "remove-member" ? t("Keluarkan {name}", { name: name || t("Siswa") }) : undefined}
        aria-busy={pending}
      >
        {pending && <Spinner />}
        {pending ? <UiText>{"Memproses…"}</UiText> : t(labels[mode])}
      </button>
      <ActionFeedback state={state} pending={pending} />
    </form>
  );
}

export function MaterialForm({
  classId,
  material,
  classes = [],
}: {
  classId?: string;
  material?: Material;
  classes?: Classroom[];
}) {
  const { t } = useI18n();
  const activeClasses = classes.filter((row) => !row.is_archived);
  const [selectedClassId, setSelectedClassId] = useState(
    classId || (activeClasses.length ? activeClasses[0].id : "")
  );
  const effectiveClassId = classId || selectedClassId;
  const [title, setTitle] = useState(material?.title || "");
  const [materialDocument,setMaterialDocument]=useState<MaterialDocument>(()=>material?.document??legacyMaterialDocument(material?.content??""));
  const content=materialPlainText(materialDocument);
  const [editorValid,setEditorValid]=useState(true);
  const [published, setPublished] = useState(material?.published || false);
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState("Mengunggah dokumen…");
  const [sourceFilename, setSourceFilename] = useState(material?.source_filename || "");
  const [sourceImportId, setSourceImportId] = useState(material?.source_import_id || "");
  const [importRefresh, setImportRefresh] = useState(0);
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");
  const [book, setBook] = useState<{ importId: string; filename: string; totalPages: number; sections: MaterialSection[] } | null>(null);
  const [pageRange, setPageRange] = useState({ first: "1", last: "30" });
  const [sectionChoice, setSectionChoice] = useState("");
  const [indexing, setIndexing] = useState(false);
  const tutorStatus = material ? materialTutorStatus(material) : null;
  const router = useRouter();
  const [state, action, pending] = useConfirmedAction(
    saveMaterial.bind(null, effectiveClassId, material?.id || null),
    {
      title: published
        ? "Terbitkan materi?"
        : "Simpan sebagai draf?",
      text: published
        ? "Semua siswa anggota kelas dapat mempelajari materi ini bersama Tutor AI."
        : "Materi ini hanya dapat dibaca guru. Siswa tidak akan melihatnya sampai diterbitkan.",
      confirmText: published ? "Ya, terbitkan" : "Ya, simpan draf",
    },
    published
      ? "Sedang memproses dan menerbitkan materi pembelajaran, mohon tunggu sebentar..."
      : "Sedang menyimpan draf materi pembelajaran, mohon tunggu sebentar...",
  );
  const canChangeTarget = canChangeMaterialTarget({ importing, hasBook: Boolean(book)||materialDocument.blocks.some(block=>block.type==="image"), sourceImportId, pending });

  async function detachImportSource() {
    if (!book && !sourceImportId) return;
    if (!(await confirmAction({
      title: "Lepas tautan dokumen impor?",
      text: "Teks yang sudah dibaca tetap ada. Materi ini tidak lagi terhubung ke riwayat impor dokumen.",
      confirmText: "Ya, lepas tautan",
    }))) return;
    setBook(null);
    setSourceImportId("");
    setImportNotice(t("Tautan impor dilepas. Teks materi tetap dipertahankan."));
  }

  async function importFile(file: File, selection?: { first: number; last: number }) {
    if (!effectiveClassId) {
      const msg = "Pilih kelas tujuan terlebih dahulu sebelum mengunggah dokumen.";
      setImportError(msg);
      await notifyResult(msg, true);
      return;
    }
    const validation = validateMaterialFile(file);
    if (validation) {
      setImportError(validation);
      await notifyResult(validation, true);
      return;
    }
    if (!(await confirmAction({ title: "Baca isi dokumen ini?", text: "Dokumen akan dibaca dan dirapikan untuk pratinjau. Setelah itu, Anda dapat meninjau dan mengubah teks sebelum menyimpan materi.", confirmText: "Ya, baca dokumen" }))) return;
    setImporting(true);
    setImportStage("Mengunggah dokumen…");
    setImportError("");
    setImportNotice("");
    void speechOutput.play({ owner: "material-form", text: "Sedang membaca dan memproses dokumen materi dengan kecerdasan buatan, mohon tunggu sebentar...", language: "id", engine: "app" });
    try {
      const body = new FormData();
      body.set("file", file);
      if (selection) {
        body.set("first_page", String(selection.first)); body.set("last_page", String(selection.last));
      }
      const response = await fetch(`/api/classes/${encodeURIComponent(effectiveClassId)}/materials/import`, { method: "POST", body });
      const receipt = await response.json();
      if (!response.ok) throw new Error(receipt.message || "Dokumen belum dapat dibaca.");
      setImportRefresh(value => value + 1);
      await waitForPreview(receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dokumen belum dapat dibaca.";
      setImportError(message);
      await notifyResult(message, true);
    } finally { setImporting(false); }
  }

  async function waitForPreview(receipt: MaterialImportRecord) {
    let record = receipt;
    for (let attempt = 0; attempt < 8 && record.state !== "complete"; attempt++) {
      if (record.state === "failed") throw new Error("Dokumen belum dapat dibaca. Gunakan Proses ulang pada dokumen tersimpan.");
      setImportStage(record.state === "running" ? "Membaca dan menyiapkan dokumen…" : "Dokumen menunggu diproses…");
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await fetch(`/api/classes/${effectiveClassId}/imports/${record.import_id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Status dokumen belum dapat dibuka.");
      record = await response.json();
    }
    setImportRefresh(value => value + 1);
    if (record.state === "complete") {
      void speechOutput.play({ owner: "material-form", text: "Pemrosesan dokumen selesai, isi materi siap ditinjau.", language: "id", engine: "app" });
      await applyPreview(record);
    } else {
      setImportNotice(t("Dokumen sedang diproses. Anda boleh meninggalkan halaman ini dan melanjutkan dari Dokumen tersimpan."));
    }
  }

  async function applyPreview(record: MaterialImportRecord) {
      const result = record.preview;
      if (!result) throw new Error("Dokumen belum dapat dibaca.");
      const selection = result.page_range;
      if (result.preview_type === "book") {
        const sections = Array.isArray(result.sections) ? result.sections as MaterialSection[] : [];
        setBook({ importId: record.import_id, filename: record.filename, totalPages: result.total_pages ?? 0, sections });
        const first = sections[0]?.first ?? 1, last = Math.min(sections[0]?.last ?? 30, first + 149);
        setPageRange({ first: String(first), last: String(last) }); setSectionChoice(sections.length ? "0" : "");
        setImportNotice(t("Pilih bab atau halaman yang ingin dijadikan materi. Isi editor belum berubah."));
        return;
      }
      if (typeof result.content !== "string" || (!result.content.trim()&&!result.document?.blocks?.length) || result.content.length > 100000) throw new Error("Teks dokumen harus berisi 1 sampai 100.000 karakter.");
      if (content.trim() && !(await confirmAction({ title: "Ganti isi teks dengan dokumen?", text: "Isi teks saat ini akan diganti dengan hasil pembacaan dokumen. Perubahan baru tersimpan setelah Anda menekan Simpan materi.", confirmText: "Ya, gunakan dokumen" }))) return;
      setMaterialDocument(result.document?validateMaterialDocument(result.document):legacyMaterialDocument(result.content));
      setEditorValid(true);
      setViewMode("preview");
      setSourceImportId(record.import_id);
      if (!title.trim()) {
        const chapter = selection && book?.sections[Number(sectionChoice)];
        setTitle(chapter && chapter.first === selection.first && chapter.last === selection.last ? chapter.title
          : `${typeof result.title === "string" ? result.title.slice(0, 170) : record.filename.replace(/\.[^.]+$/, "")}${selection ? ` · ${t("Halaman {first}–{last}", selection)}` : ""}`);
      }
      const source = typeof result.filename === "string" ? result.filename : record.filename;
      setSourceFilename(`${source}${selection ? ` · ${t("Halaman {first}–{last}", selection)}` : ""}`.slice(0, 300));
      if (!selection) setBook(null);
      const warnings = Array.isArray(result.warnings) ? result.warnings.filter((item: unknown): item is string => typeof item === "string").map(item => t(item)).join(" ") : "";
      setImportNotice(`${t("Dokumen berhasil dibaca dan dirapikan. Tinjau isi sebelum menyimpan.")}${warnings ? ` ${warnings}` : ""}`);
      await notifyResult("Dokumen siap ditinjau.");
  }

  async function importPages() {
    if (!book || !effectiveClassId) return;
    try {
      const selection = parseMaterialPageRange(pageRange.first, pageRange.last);
      if (!selection || selection.last > book.totalPages) throw new Error(t("Pilihan halaman tidak valid."));
      if (!(await confirmAction({ title: "Baca halaman terpilih?", text: "Halaman ini akan dibaca dari dokumen yang tersimpan.", confirmText: "Baca halaman" }))) return;
      setImporting(true);
      setImportStage("Menyiapkan halaman terpilih…");
      void speechOutput.play({ owner: "material-form", text: "Sedang membaca halaman terpilih dari dokumen, mohon tunggu sebentar...", language: "id", engine: "app" });
      const response = await fetch(`/api/classes/${effectiveClassId}/imports/${book.importId}/pages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ first_page: selection.first, last_page: selection.last }) });
      const receipt = await response.json();
      if (!response.ok) throw new Error(receipt.message || "Pilihan halaman tidak valid.");
      await waitForPreview(receipt);
    } catch (error) { setImportError(error instanceof Error ? error.message : "Pilihan halaman tidak valid."); }
    finally { setImporting(false); setImportRefresh(value => value + 1); }
  }

  async function retryIndex() {
    if (!material?.published || !effectiveClassId || !(await confirmAction({ title: "Siapkan materi untuk Tutor?", text: "Tutor akan memakai isi materi yang terakhir disimpan. Perubahan di editor perlu disimpan terlebih dahulu.", confirmText: "Ya, siapkan materi" }))) return;
    setIndexing(true);
    void speechOutput.play({ owner: "material-form", text: "Sedang menyiapkan materi untuk Tutor kecerdasan buatan, mohon tunggu sebentar...", language: "id", engine: "app" });
    try {
      const response = await fetch(`/api/classes/${effectiveClassId}/materials/${material.id}/index`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Materi belum dapat disiapkan.");
      await notifyResult("Materi sedang disiapkan untuk Tutor. Perbarui status untuk melihat hasilnya.");
      void speechOutput.play({ owner: "material-form", text: "Materi berhasil disiapkan untuk Tutor kecerdasan buatan.", language: "id", engine: "app" });
      router.refresh();
    } catch (error) { await notifyResult(error instanceof Error ? error.message : "Materi belum dapat disiapkan.", true); }
    finally { setIndexing(false); }
  }
  return (
    <form
      action={action}
      onReset={(e) => e.preventDefault()}
      className="panel form-panel form-stack stepped-material-form"
    >
      <ActionFeedback state={state} pending={pending} pendingLabel="Menyimpan materi…" />
      <input type="hidden" name="class_id" value={effectiveClassId} />
      <LoadingStatus active={indexing} label="Menyiapkan materi untuk Tutor…" />
      <input type="hidden" name="source_filename" value={sourceFilename} />
      <input type="hidden" name="source_import_id" value={sourceImportId} />
      {material && tutorStatus && (
        <section className={`material-ai-status ${material.rag_status === "failed" ? "failed" : ""}`} aria-label={t("Kesiapan materi untuk Tutor")}>
          <div>
            <strong>{material.published && ["pending", "processing"].includes(material.rag_status ?? "") && <Spinner className="loading-inline-icon" />}{t(tutorStatus.heading)}</strong>
            <p>{t(tutorStatus.description)}</p>
          </div>
          <div className="material-status-actions">
            <RefreshButton label="Perbarui status" disabled={pending || importing || indexing} />
            {tutorStatus.actionLabel && <Button type="button" onClick={() => void retryIndex()} disabled={pending || importing || indexing} loading={indexing} loadingText={t("Menyiapkan materi…")}>{t(tutorStatus.actionLabel)}</Button>}
          </div>
        </section>
      )}

      {/* Top Stepper Navigation */}
      <nav className="material-form-stepper" aria-label={t("Langkah pembuatan materi")}>
        <div className={`stepper-step ${effectiveClassId ? "is-completed" : "is-active"}`}>
          <div className="stepper-circle">
            <span className="stepper-num">1</span>
          </div>
          <div className="stepper-text">
            <span className="stepper-label"><UiText>{"01 · Sumber & Kelas"}</UiText></span>
            <span className="stepper-desc"><UiText>{"Pilih kelas dan unggah dokumen"}</UiText></span>
          </div>
        </div>

        <div className="stepper-connector" aria-hidden="true" />

        <div className={`stepper-step ${content.trim() ? "is-completed" : effectiveClassId ? "is-active" : ""}`}>
          <div className="stepper-circle">
            <span className="stepper-num">2</span>
          </div>
          <div className="stepper-text">
            <span className="stepper-label"><UiText>{"02 · Tinjau dan sunting teks"}</UiText></span>
            <span className="stepper-desc"><UiText>{"Periksa dan rapikan konten materi"}</UiText></span>
          </div>
        </div>

        <div className="stepper-connector" aria-hidden="true" />

        <div className={`stepper-step ${title.trim() && content.trim() ? "is-completed" : ""}`}>
          <div className="stepper-circle">
            <span className="stepper-num">3</span>
          </div>
          <div className="stepper-text">
            <span className="stepper-label"><UiText>{"03 · Judul & Publikasi"}</UiText></span>
            <span className="stepper-desc"><UiText>{"Atur visibilitas dan simpan materi"}</UiText></span>
          </div>
        </div>
      </nav>

      {/* Step 1: Sumber Dokumen & Kelas Tujuan */}
      <div className="form-step-container">
        <div className="form-step-header">
          <span className="form-step-num">1</span>
          <div>
            <h3><UiText>{"Sumber Dokumen & Kelas Tujuan"}</UiText></h3>
            <p className="muted"><UiText>{"Unggah dokumen materi pembelajaran Anda (PDF, DOCX, TXT, MD)."}</UiText></p>
          </div>
        </div>

        {!classId && activeClasses.length > 0 && (
          <div className="field">
            <span className="field-label" style={{ fontWeight: 600, display: "block", marginBottom: ".5rem" }}><UiText>{"Pilih kelas tujuan"}</UiText></span>
            <div className="target-class-grid" role="radiogroup" aria-label={t("Pilih kelas tujuan")}>
              {activeClasses.map((cls) => {
                const isSelected = cls.id === effectiveClassId;
                return (
                  <button
                    key={cls.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`target-class-card ${isSelected ? "is-selected" : ""}`}
                    disabled={!canChangeTarget}
                    onClick={() => setSelectedClassId(cls.id)}
                  >
                    <div className="target-class-top">
                      <span className="class-subject-badge">
                        <BookOpenCheck size={13} aria-hidden="true" />
                        <span>{cls.subject}</span>
                      </span>
                      {isSelected && <CheckCircle2 size={16} className="class-check-icon" aria-hidden="true" />}
                    </div>
                    <strong className="target-class-name">{cls.name}</strong>
                  </button>
                );
              })}
            </div>
            {!canChangeTarget && <div className="target-class-lock">
              <p className="muted" role="status"><UiText>{"Kelas tujuan terkunci selama impor. Lepas tautan dokumen untuk mengganti kelas; teks hasil bacaan tetap disimpan."}</UiText></p>
              {!importing && !pending && (book || sourceImportId) && <button type="button" className="button secondary" onClick={() => void detachImportSource()}><UiText>{"Lepas tautan impor"}</UiText></button>}
            </div>}
          </div>
        )}

        <section className="material-import" aria-label={t("Impor dokumen materi")}>
          <div className="material-import-heading">
            <span className="material-import-icon" aria-hidden="true"><UploadCloud size={24} /></span>
            <div><h2><UiText>{"Mulai dari dokumen Anda"}</UiText></h2><p><UiText>{"Unggah dokumen, sistem akan merapikan teks secara otomatis untuk pratinjau."}</UiText></p></div>
          </div>
          <label className="field"><UiText>{"Pilih dokumen materi (opsional)"}</UiText><input
            type="file"
            accept=".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            disabled={pending || importing || !effectiveClassId}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
          <small><UiText>{"PDF, termasuk hasil scan, DOCX, Markdown, atau TXT. Maksimal 25 MB."}</UiText></small>
          </label>
          {book && <fieldset className="book-import-picker" disabled={importing || pending}>
            <legend>{t("Pilih bagian buku")}</legend>
            <p>{book.filename} · {t("{count} halaman", { count: book.totalPages })}</p>
            <label className="field">{t("Saran pembagian")}
              <NativeSelect value={sectionChoice} onChange={event => {
                const next = event.target.value; setSectionChoice(next);
                const section = book.sections[Number(next)];
                if (next !== "" && section) setPageRange({ first: String(section.first), last: String(Math.min(section.last, section.first + 149)) });
              }}>
                <option value="">{t("Pilih halaman sendiri")}</option>
                {book.sections.map((section, index) => <option key={`${section.first}-${index}`} value={String(index)}>
                  {section.title} · {t("Halaman {first}–{last}", section)}</option>)}
              </NativeSelect>
            </label>
            <div className="book-import-range">
              <label className="field">{t("Halaman awal")}<Input type="number" min={1} max={book.totalPages} value={pageRange.first}
                onChange={event => { setSectionChoice(""); setPageRange({ ...pageRange, first: event.target.value }); }} /></label>
              <label className="field">{t("Halaman akhir")}<Input type="number" min={1} max={book.totalPages} value={pageRange.last}
                onChange={event => { setSectionChoice(""); setPageRange({ ...pageRange, last: event.target.value }); }} /></label>
            </div>
            <small>{t("Gunakan nomor halaman PDF, termasuk sampul. Maksimal 150 halaman dan 100.000 karakter per materi. Bab yang panjang bisa dibagi lagi.")}</small>
            <small>{t("Tinjau saran bab sebelum menyimpan. Simpan setiap bab sebagai materi tersendiri; modul pendek dapat langsung menjadi satu materi.")}</small>
            <div className="material-status-actions">
              <button type="button" className="button primary" onClick={() => void importPages()}>{t("Baca halaman terpilih")}</button>
              <button type="button" className="button secondary" onClick={() => setBook(null)}>{t("Batal")}</button>
            </div>
          </fieldset>}
          <LoadingStatus active={importing} label={importStage} description="Hasil pembacaan akan muncul untuk ditinjau sebelum disimpan." />
          {sourceFilename && <p className="material-source-file"><FileText size={17} aria-hidden="true" /><span>{sourceFilename}</span></p>}
          {importNotice && <p className="material-import-notice" role="status">{importNotice}</p>}
          {importError && <p className="alert error-message" role="alert">{t(importError)}</p>}
        </section>
        {effectiveClassId && <MaterialImportHistory classId={effectiveClassId} refreshKey={importRefresh} onPreview={applyPreview} />}
      </div>

      {/* Step 2: Tinjau & Edit Isi Materi */}
      <div className="form-step-container">
        <div className="form-step-header" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span className="form-step-num">2</span>
            <div>
              <h3><UiText>{"Tinjau dan sunting isi materi"}</UiText></h3>
              <p className="muted"><UiText>{"Periksa isi teks sebelum disimpan. Anda dapat mengedit teks secara langsung."}</UiText></p>
            </div>
          </div>
          <div className="preview-edit-switch">
            <button
              type="button"
              className={`button ${viewMode === "preview" ? "secondary active" : "ghost"}`}
              onClick={() => setViewMode("preview")}
            >
              <Eye size={16} aria-hidden="true" />
              <UiText>{"Pratinjau Rapi"}</UiText>
            </button>
            <button
              type="button"
              className={`button ${viewMode === "edit" ? "secondary active" : "ghost"}`}
              onClick={() => setViewMode("edit")}
            >
              <Edit3 size={16} aria-hidden="true" />
              <UiText>{"Sunting teks"}</UiText>
            </button>
          </div>
        </div>

        <input type="hidden" name="document" value={JSON.stringify(materialDocument)}/>
        <input type="hidden" name="expected_version" value={material?.content_version??1}/>
        {viewMode==="preview"?<div className="material-preview-card"><MaterialRenderer document={materialDocument} classId={effectiveClassId} showReview/></div>:<MaterialRichEditor value={materialDocument} onChange={setMaterialDocument} classId={effectiveClassId} disabled={importing||pending} onValidityChange={setEditorValid}/>}
        <MaterialSourceReview document={materialDocument} onChange={next=>{try{setMaterialDocument(validateMaterialDocument(next));setEditorValid(true);}catch{setImportError("Periksa format rumus dan teks sebelum menyimpan.");}}} classId={effectiveClassId} disabled={importing||pending} originalUrl={sourceImportId&&/\.pdf/i.test(sourceFilename)?`/api/classes/${effectiveClassId}/imports/${sourceImportId}/original`:undefined}/>
        <div className="char-count-meta" style={{ display: "flex", justifyContent: "space-between", marginTop: ".5rem", color: "var(--muted)", fontSize: ".85rem" }}>
          <span>{content.length.toLocaleString("id-ID")}<UiText>{" / 100.000 karakter"}</UiText></span>
          <span><UiText>{"Materi terbit otomatis disiapkan untuk dipelajari bersama Tutor AI."}</UiText></span>
        </div>
      </div>

      {/* Step 3: Judul & Publikasi */}
      <div className="form-step-container">
        <div className="form-step-header">
          <span className="form-step-num">3</span>
          <div>
            <h3><UiText>{"Judul & Publikasi"}</UiText></h3>
            <p className="muted"><UiText>{"Beri nama materi dan tentukan siapa yang dapat mengaksesnya."}</UiText></p>
          </div>
        </div>

        <label className="field"><UiText>{"Judul materi"}</UiText><Input
            required
            maxLength={200}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Contoh: Mengenal persamaan linear")}
          />
        </label>

        <div className="field">
          <span className="field-label" style={{ fontWeight: 600, display: "block", marginBottom: ".5rem" }}><UiText>{"Status Publikasi"}</UiText></span>
          <input type="hidden" name="published" value={published ? "yes" : "no"} />
          <div className="visibility-picker-grid">
            <button
              type="button"
              className={`visibility-card ${!published ? "is-selected" : ""}`}
              onClick={() => setPublished(false)}
            >
              <div className="visibility-card-top">
                <strong><UiText>{"Draf"}</UiText></strong>
                {!published && <CheckCircle2 size={16} aria-hidden="true" />}
              </div>
              <p><UiText>{"Hanya guru yang dapat melihat. Cocok untuk materi yang masih disiapkan."}</UiText></p>
            </button>
            <button
              type="button"
              className={`visibility-card ${published ? "is-selected" : ""}`}
              onClick={() => setPublished(true)}
            >
              <div className="visibility-card-top">
                <strong><UiText>{"Terbitkan"}</UiText></strong>
                {published && <CheckCircle2 size={16} aria-hidden="true" />}
              </div>
              <p><UiText>{"Siswa dapat membaca materi yang terbit. Tutor menggunakan isi yang sudah ditinjau dan siap indeks."}</UiText></p>
            </button>
          </div>
        </div>

        <button className="button primary save-material-btn" disabled={pending || importing || !effectiveClassId || !materialDocument.blocks.length || !editorValid}>
          {pending && <Spinner />}
          {pending ? <UiText>{"Menyimpan…"}</UiText> : <UiText>{"Simpan materi"}</UiText>}
        </button>
      </div>
    </form>
  );
}
