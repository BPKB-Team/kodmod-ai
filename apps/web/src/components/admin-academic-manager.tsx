"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap,
  BookOpen,
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  UserCheck,
  AlertTriangle,
  RotateCcw,
  BookMarked,
  Layers,
  FileCheck2,
  Users,
  Archive,
} from "lucide-react";
import { useI18n, UiText } from "./language-provider";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Badge, Empty } from "./ui";
import type { AdminClass, AdminSubject } from "@/lib/admin-academic-types";
import type { User } from "@/lib/types";
import {
  saveAdminClass,
  deleteAdminClass,
  saveAdminSubject,
  deleteAdminSubject,
} from "@/app/admin-academic-actions";
import "@/styles/admin-academic.css";

interface Props {
  initialClasses: AdminClass[];
  initialSubjects: AdminSubject[];
  teachers: User[];
}

export function AdminAcademicManager({
  initialClasses,
  initialSubjects,
  teachers,
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"classes" | "subjects">("classes");
  const [isPending, startTransition] = useTransition();

  // Search and filter states
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<"all" | "active" | "archived">("all");

  // Modal states for Class
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<AdminClass | null>(null);
  const [className, setClassName] = useState("");
  const [classSubjectId, setClassSubjectId] = useState("");
  const [classTeacherId, setClassTeacherId] = useState("");
  const [classDesc, setClassDesc] = useState("");
  const [classArchived, setClassArchived] = useState(false);

  // Modal states for Subject
  const [isSubjModalOpen, setIsSubjModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<AdminSubject | null>(null);
  const [subjName, setSubjName] = useState("");
  const [subjDesc, setSubjDesc] = useState("");

  // Filtered lists
  const filteredClasses = initialClasses.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.subject.toLowerCase().includes(search.toLowerCase()) ||
      c.teacher_name.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (classFilter === "active") return !c.is_archived;
    if (classFilter === "archived") return c.is_archived;
    return true;
  });

  const filteredSubjects = initialSubjects.filter((s) => {
    return (
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description && s.description.toLowerCase().includes(search.toLowerCase()))
    );
  });

  // Open modals
  const openAddClass = () => {
    setEditingClass(null);
    setClassName("");
    setClassSubjectId(initialSubjects[0]?.id || "");
    setClassTeacherId(teachers[0]?.id || "");
    setClassDesc("");
    setClassArchived(false);
    setIsClassModalOpen(true);
  };

  const openEditClass = (c: AdminClass) => {
    setEditingClass(c);
    setClassName(c.name);
    setClassSubjectId(c.subject_id || "");
    setClassTeacherId(c.teacher_id);
    setClassDesc(c.description || "");
    setClassArchived(c.is_archived);
    setIsClassModalOpen(true);
  };

  const openAddSubject = () => {
    setEditingSubject(null);
    setSubjName("");
    setSubjDesc("");
    setIsSubjModalOpen(true);
  };

  const openEditSubject = (s: AdminSubject) => {
    setEditingSubject(s);
    setSubjName(s.name);
    setSubjDesc(s.description || "");
    setIsSubjModalOpen(true);
  };

  // Submit Class Form
  const handleSubmitClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim()) {
      await notifyResult("Isi nama kelas terlebih dahulu.", true);
      return;
    }
    if (!editingClass && !classTeacherId) {
      await notifyResult("Pilih guru pengampu kelas.", true);
      return;
    }
    if (!editingClass && !classSubjectId) {
      await notifyResult("Pilih mata pelajaran kelas.", true);
      return;
    }

    const formData = new FormData();
    if (editingClass) formData.append("id", editingClass.id);
    formData.append("name", className.trim());
    formData.append("subject_id", classSubjectId);
    formData.append("teacher_id", classTeacherId);
    formData.append("description", classDesc.trim());
    formData.append("is_archived", classArchived ? "true" : "false");

    startTransition(async () => {
      const res = await saveAdminClass({ error: undefined }, formData);
      if (res.error) {
        await notifyResult(res.error, true);
      } else {
        await notifyResult(res.success || "Data kelas berhasil disimpan.");
        setIsClassModalOpen(false);
        router.refresh();
      }
    });
  };

  // Submit Subject Form
  const handleSubmitSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjName.trim()) {
      await notifyResult("Isi nama mata pelajaran terlebih dahulu.", true);
      return;
    }

    const formData = new FormData();
    if (editingSubject) formData.append("id", editingSubject.id);
    formData.append("name", subjName.trim());
    formData.append("description", subjDesc.trim());

    startTransition(async () => {
      const res = await saveAdminSubject({ error: undefined }, formData);
      if (res.error) {
        await notifyResult(res.error, true);
      } else {
        await notifyResult(res.success || "Mata pelajaran berhasil disimpan.");
        setIsSubjModalOpen(false);
        router.refresh();
      }
    });
  };

  // Delete Class with SweetAlert2 confirmation
  const handleDeleteClass = async (c: AdminClass) => {
    const confirmed = await confirmAction({
      title: "Hapus kelas secara permanen?",
      text: `PERINGATAN: Menghapus kelas '${c.name}' akan melenyapkan seluruh data turunannya secara total! Semua materi kelas, riwayat belajar, pendaftaran siswa, tugas kuis, dan nilai akan dihapus permanen. Tindakan ini tidak dapat dibatalkan!`,
      confirmText: "Ya, hapus permanen",
      destructive: true,
    });

    if (!confirmed) return;

    const formData = new FormData();
    formData.append("id", c.id);

    startTransition(async () => {
      const res = await deleteAdminClass({ error: undefined }, formData);
      if (res.error) {
        await notifyResult(res.error, true);
      } else {
        await notifyResult(res.success || "Kelas berhasil dihapus permanen.");
        router.refresh();
      }
    });
  };

  // Delete Subject with SweetAlert2 confirmation
  const handleDeleteSubject = async (s: AdminSubject) => {
    const confirmed = await confirmAction({
      title: "Hapus mata pelajaran secara permanen?",
      text: `PERINGATAN: Menghapus mata pelajaran '${s.name}' akan melenyapkan seluruh data turunannya secara total! Semua kelas di bawah mata pelajaran ini, materi, konsep kurikulum, dokumen, dan kuis akan dihapus permanen. Tindakan ini tidak dapat dibatalkan!`,
      confirmText: "Ya, hapus permanen",
      destructive: true,
    });

    if (!confirmed) return;

    const formData = new FormData();
    formData.append("id", s.id);

    startTransition(async () => {
      const res = await deleteAdminSubject({ error: undefined }, formData);
      if (res.error) {
        await notifyResult(res.error, true);
      } else {
        await notifyResult(res.success || "Mata pelajaran berhasil dihapus permanen.");
        router.refresh();
      }
    });
  };

  return (
    <div className="academic-container">
      {/* Tab Navigation */}
      <div className="academic-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "classes"}
          className={`academic-tab-btn ${activeTab === "classes" ? "active" : ""}`}
          onClick={() => setActiveTab("classes")}
        >
          <GraduationCap size={18} aria-hidden="true" />
          <span>{t("Daftar Kelas")}</span>
          <span className="academic-tab-badge">{initialClasses.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "subjects"}
          className={`academic-tab-btn ${activeTab === "subjects" ? "active" : ""}`}
          onClick={() => setActiveTab("subjects")}
        >
          <BookOpen size={18} aria-hidden="true" />
          <span>{t("Mata Pelajaran")}</span>
          <span className="academic-tab-badge">{initialSubjects.length}</span>
        </button>
      </div>

      {/* Header Toolbar */}
      <div className="academic-header-bar">
        <div className="academic-filters">
          <div className="academic-search-box">
            <Search size={18} className="academic-search-icon" aria-hidden="true" />
            <Input
              type="search"
              placeholder={
                activeTab === "classes"
                  ? "Cari nama kelas, mapel, guru..."
                  : "Cari mata pelajaran..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="academic-search-input"
            />
          </div>

          {activeTab === "classes" && (
            <div style={{ minWidth: "160px" }}>
              <NativeSelect
                value={classFilter}
                onChange={(e) =>
                  setClassFilter(e.target.value as "all" | "active" | "archived")
                }
              >
                <option value="all">{t("Semua Status")}</option>
                <option value="active">{t("Aktif")}</option>
                <option value="archived">{t("Diarsipkan")}</option>
              </NativeSelect>
            </div>
          )}

          {search && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setSearch("")}
              style={{ padding: "0.5rem 0.85rem", fontSize: "0.85rem" }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>{t("Atur ulang")}</span>
            </button>
          )}
        </div>

        <div className="academic-actions">
          {activeTab === "classes" ? (
            <button
              type="button"
              className="button primary"
              onClick={openAddClass}
              disabled={isPending}
            >
              <Plus size={16} aria-hidden="true" />
              <span>{t("Tambah Kelas")}</span>
            </button>
          ) : (
            <button
              type="button"
              className="button primary"
              onClick={openAddSubject}
              disabled={isPending}
            >
              <Plus size={16} aria-hidden="true" />
              <span>{t("Tambah Mata Pelajaran")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab 1: Daftar Kelas */}
      {activeTab === "classes" && (
        <>
          {filteredClasses.length === 0 ? (
            <Empty title={<UiText>{"Tidak ada kelas ditemukan"}</UiText>}>
              {search
                ? t("Coba ubah kata kunci pencarian atau bersihkan filter.")
                : t("Belum ada kelas yang terdaftar. Tambahkan kelas baru.")}
            </Empty>
          ) : (
            <div className="academic-grid">
              {filteredClasses.map((c) => (
                <div key={c.id} className="academic-card">
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div className="academic-card-header">
                      <div>
                        <h3 className="academic-card-title">{c.name}</h3>
                        <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                          <Badge>{c.subject}</Badge>
                          {c.is_archived && (
                            <Badge active>
                              <Archive size={12} style={{ marginRight: "3px" }} />
                              {t("Diarsipkan")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {c.description && (
                      <p className="academic-card-desc">{c.description}</p>
                    )}

                    <div className="academic-card-meta">
                      <div className="academic-meta-row">
                        <UserCheck size={15} style={{ color: "var(--primary, #1b4332)" }} />
                        <span>
                          <strong>{t("Guru")}:</strong> {c.teacher_name} (@{c.teacher_username})
                        </span>
                      </div>
                      <div className="academic-stats-row" style={{ marginTop: "0.25rem" }}>
                        <span className="academic-stat-chip">
                          <Users size={13} />
                          {c.member_count} {t("Siswa")}
                        </span>
                        <span className="academic-stat-chip">
                          <BookMarked size={13} />
                          {c.material_count} {t("Materi")}
                        </span>
                        <span className="academic-stat-chip">
                          <FileCheck2 size={13} />
                          {c.assignment_count} {t("Tugas")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="academic-card-footer">
                    <span style={{ fontSize: "0.775rem", color: "var(--text-muted, #94a3b8)" }}>
                      {new Intl.DateTimeFormat("id-ID", {
                        dateStyle: "medium",
                      }).format(new Date(c.created_at))}
                    </span>
                    <div className="academic-btn-group">
                      <button
                        type="button"
                        className="academic-action-btn academic-btn-edit"
                        onClick={() => openEditClass(c)}
                        disabled={isPending}
                        title={t("Ubah kelas")}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        <span>{t("Ubah")}</span>
                      </button>
                      <button
                        type="button"
                        className="academic-action-btn academic-btn-delete"
                        onClick={() => handleDeleteClass(c)}
                        disabled={isPending}
                        title={t("Hapus kelas dan semua data turunan")}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>{t("Hapus")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tab 2: Mata Pelajaran */}
      {activeTab === "subjects" && (
        <>
          {filteredSubjects.length === 0 ? (
            <Empty title={<UiText>{"Tidak ada mata pelajaran ditemukan"}</UiText>}>
              {search
                ? t("Coba ubah kata kunci pencarian atau bersihkan filter.")
                : t("Belum ada mata pelajaran. Tambahkan mata pelajaran baru.")}
            </Empty>
          ) : (
            <div className="academic-grid">
              {filteredSubjects.map((s) => (
                <div key={s.id} className="academic-card">
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div className="academic-card-header">
                      <div>
                        <h3 className="academic-card-title">{s.name}</h3>
                      </div>
                    </div>

                    <p className="academic-card-desc">
                      {s.description || t("Belum ada deskripsi mata pelajaran.")}
                    </p>

                    <div className="academic-card-meta">
                      <div className="academic-meta-row">
                        <GraduationCap size={15} style={{ color: "var(--primary, #1b4332)" }} />
                        <span>
                          <strong>{t("Dibuat oleh")}:</strong> {s.creator_name || "Sistem"}
                        </span>
                      </div>
                      <div className="academic-stats-row" style={{ marginTop: "0.25rem" }}>
                        <span className="academic-stat-chip">
                          <Layers size={13} />
                          {s.class_count} {t("Kelas")}
                        </span>
                        <span className="academic-stat-chip">
                          <BookMarked size={13} />
                          {s.concept_count} {t("Konsep")}
                        </span>
                        <span className="academic-stat-chip">
                          <FileCheck2 size={13} />
                          {s.document_count} {t("Dokumen")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="academic-card-footer">
                    <span style={{ fontSize: "0.775rem", color: "var(--text-muted, #94a3b8)" }}>
                      {new Intl.DateTimeFormat("id-ID", {
                        dateStyle: "medium",
                      }).format(new Date(s.created_at))}
                    </span>
                    <div className="academic-btn-group">
                      <button
                        type="button"
                        className="academic-action-btn academic-btn-edit"
                        onClick={() => openEditSubject(s)}
                        disabled={isPending}
                        title={t("Ubah mata pelajaran")}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        <span>{t("Ubah")}</span>
                      </button>
                      <button
                        type="button"
                        className="academic-action-btn academic-btn-delete"
                        onClick={() => handleDeleteSubject(s)}
                        disabled={isPending}
                        title={t("Hapus mata pelajaran dan semua data turunan")}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>{t("Hapus")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal Dialog: Add / Edit Class */}
      {isClassModalOpen && (
        <div
          className="academic-modal-overlay"
          onClick={() => !isPending && setIsClassModalOpen(false)}
        >
          <div
            className="academic-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="academic-modal-header">
              <h2 className="academic-modal-title">
                <GraduationCap size={20} aria-hidden="true" />
                <span>{editingClass ? t("Ubah Kelas") : t("Tambah Kelas Baru")}</span>
              </h2>
              <button
                type="button"
                className="academic-modal-close"
                onClick={() => !isPending && setIsClassModalOpen(false)}
                aria-label={t("Tutup")}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitClass}>
              <div className="academic-modal-body">
                <div className="academic-field">
                  <label htmlFor="className">
                    {t("Nama Kelas")} <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <Input
                    id="className"
                    required
                    maxLength={120}
                    placeholder={t("Contoh: Kelas 10 RPL A")}
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                  />
                </div>

                <div className="academic-field">
                  <label htmlFor="classSubject">
                    {t("Mata Pelajaran")} <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <NativeSelect
                    id="classSubject"
                    value={classSubjectId}
                    onChange={(e) => setClassSubjectId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      {t("-- Pilih Mata Pelajaran --")}
                    </option>
                    {initialSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="academic-field">
                  <label htmlFor="classTeacher">
                    {t("Guru Pengampu")} <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <NativeSelect
                    id="classTeacher"
                    value={classTeacherId}
                    onChange={(e) => setClassTeacherId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      {t("-- Pilih Guru Pengampu --")}
                    </option>
                    {teachers.map((tch) => (
                      <option key={tch.id} value={tch.id}>
                        {tch.full_name} (@{tch.username})
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="academic-field">
                  <label htmlFor="classDesc">{t("Deskripsi Kelas (Opsional)")}</label>
                  <textarea
                    id="classDesc"
                    maxLength={2000}
                    placeholder={t("Jelaskan ringkasan materi atau tujuan kelas ini…")}
                    value={classDesc}
                    onChange={(e) => setClassDesc(e.target.value)}
                  />
                </div>

                {editingClass && (
                  <label className="academic-checkbox-field">
                    <input
                      type="checkbox"
                      checked={classArchived}
                      onChange={(e) => setClassArchived(e.target.checked)}
                    />
                    <span>{t("Arsipkan kelas ini (nonaktifkan aktivitas belajar)")}</span>
                  </label>
                )}

                {editingClass && (
                  <div className="academic-warning-box">
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
                    <div>
                      <strong>{t("Informasi")}:</strong>{" "}
                      {t(
                        "Jika kelas dihapus, semua materi, riwayat belajar, dan tugas di dalamnya akan dihapus permanen secara total."
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="academic-modal-footer">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setIsClassModalOpen(false)}
                  disabled={isPending}
                >
                  {t("Batal")}
                </button>
                <button type="submit" className="button primary" disabled={isPending}>
                  {isPending ? t("Menyimpan...") : t("Simpan Kelas")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Dialog: Add / Edit Subject */}
      {isSubjModalOpen && (
        <div
          className="academic-modal-overlay"
          onClick={() => !isPending && setIsSubjModalOpen(false)}
        >
          <div
            className="academic-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="academic-modal-header">
              <h2 className="academic-modal-title">
                <BookOpen size={20} aria-hidden="true" />
                <span>
                  {editingSubject
                    ? t("Ubah Mata Pelajaran")
                    : t("Tambah Mata Pelajaran Baru")}
                </span>
              </h2>
              <button
                type="button"
                className="academic-modal-close"
                onClick={() => !isPending && setIsSubjModalOpen(false)}
                aria-label={t("Tutup")}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitSubject}>
              <div className="academic-modal-body">
                <div className="academic-field">
                  <label htmlFor="subjName">
                    {t("Nama Mata Pelajaran")} <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <Input
                    id="subjName"
                    required
                    maxLength={120}
                    placeholder={t("Contoh: Matematika Peminatan")}
                    value={subjName}
                    onChange={(e) => setSubjName(e.target.value)}
                  />
                </div>

                <div className="academic-field">
                  <label htmlFor="subjDesc">
                    {t("Deskripsi Mata Pelajaran (Opsional)")}
                  </label>
                  <textarea
                    id="subjDesc"
                    maxLength={2000}
                    placeholder={t("Jelaskan cakupan kurikulum atau topik mata pelajaran…")}
                    value={subjDesc}
                    onChange={(e) => setSubjDesc(e.target.value)}
                  />
                </div>

                {editingSubject && (
                  <div className="academic-warning-box">
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
                    <div>
                      <strong>{t("Perhatian Kaskade Total")}:</strong>{" "}
                      {t(
                        "Jika mata pelajaran ini dihapus, SEMUA kelas, materi, konsep, dan kuis yang menginduk padanya akan ikut terhapus secara total dari sistem!"
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="academic-modal-footer">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setIsSubjModalOpen(false)}
                  disabled={isPending}
                >
                  {t("Batal")}
                </button>
                <button type="submit" className="button primary" disabled={isPending}>
                  {isPending ? t("Menyimpan...") : t("Simpan Mata Pelajaran")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
