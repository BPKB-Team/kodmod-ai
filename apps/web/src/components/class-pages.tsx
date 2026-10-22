
import { UiText, UiDate } from "@/components/language-provider";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  BookOpenCheck,
  CheckCircle2,
  Layers3,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Search,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { classroomData } from "@/lib/classrooms";
import { requireSession } from "@/lib/session";
import { dateLabel } from "@/lib/types";
import type {
  Classroom,
  ClassDetail,
  LearningRole,
  Material,
  StudentMaterial,
} from "@/lib/class-types";
import { Empty, Heading } from "./ui";
import { ClassAction, MaterialForm, MemberPicker } from "./class-forms";
import {MaterialRenderer} from "./material-renderer";
import {legacyMaterialDocument} from "@/lib/material-document-adapter.mjs";
import { StudentReader } from "./student-reader";
import { StudentOverview } from "./student-overview";
import { readingSettings } from "@/lib/reading-settings";
import { readingDefaults } from "@/lib/reading-preferences";
import { backend } from "@/lib/server-api";
import type { CurriculumConcept, CurriculumSubject, MaterialMapping } from "@/lib/concept-types";
import { ClassSubjectForm, MaterialConceptsForm } from "./material-concepts-form";

const baseFor = (role: LearningRole) =>
  role === "teacher" ? "/guru" : "/siswa";
export function BackToClasses({ role }: { role: LearningRole }) {
  const isStudent = role === "student";
  return (
    <Link
      className={`learning-back ${isStudent ? "student-back-link" : ""}`}
      href={`${baseFor(role)}/kelas`}
      data-voice-menu={isStudent ? "classes" : undefined}
      aria-label={isStudent ? "Kembali ke semua kelas saya" : undefined}
    >
      <ArrowLeft size={16} aria-hidden="true" />
      <UiText>{"Semua kelas"}</UiText>
    </Link>
  );
}
function ClassCards({ rows, role }: { rows: Classroom[]; role: LearningRole }) {
  const isStudent = role === "student";
  return rows.length ? (
    <div className={`class-grid ${isStudent ? "student-class-grid" : ""}`}>
      {rows.map((row) => (
        <Link
          href={`${baseFor(role)}/kelas/${row.id}`}
          className={`class-card panel ${isStudent ? "student-tactile-card" : ""}`}
          key={row.id}
          aria-label={
            isStudent
              ? `${row.name}. Mata pelajaran ${row.subject}. ${row.material_count} materi, ${row.member_count} siswa.`
              : undefined
          }
        >
          <div className="class-card-top">
            <span className="class-symbol">
              <BookOpen size={22} aria-hidden="true" />
            </span>
            {row.is_archived && (
              <span className="class-status-badge archived">
                <UiText>{"Diarsipkan"}</UiText>
              </span>
            )}
          </div>
          <div className="class-card-subject">
            <span className="class-subject-badge" title={row.subject}>
              <BookOpenCheck size={13} aria-hidden="true" />
              <span>{row.subject}</span>
            </span>
          </div>
          <h3>{row.name}</h3>
          <p>
            {row.description ||
              `Ruang belajar ${row.subject} bersama ${row.teacher_name}.`}
          </p>
          <div className="class-card-bottom">
            <span>
              {row.material_count}<UiText>{" materi · "}</UiText>{row.member_count}<UiText>{" siswa"}</UiText>
            </span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </div>
        </Link>
      ))}
    </div>
  ) : (
    <div className="panel">
      <Empty
        title={
          role === "teacher"
            ? <UiText>{"Ruang untuk ide pertama Anda."}</UiText>
            : <UiText>{"Belum ada kelas yang terdaftar."}</UiText>
        }
      >
        {role === "teacher" ? (
          <div style={{ display: "grid", gap: "1rem", justifyItems: "center" }}>
            <UiText>{"Buat kelas, tambahkan siswa, lalu bagikan materi pertama."}</UiText>
            <Link className="button primary" href="/guru/kelas/baru">
              <Plus size={16} aria-hidden="true" />
              <UiText>{"Buat kelas baru"}</UiText>
            </Link>
          </div>
        ) : (
          <UiText>{"Minta gurumu menambahkan akunmu ke dalam kelas untuk mulai belajar."}</UiText>
        )}
      </Empty>
    </div>
  );
}
export async function ClassIndex({
  role,
  dashboard = false,
  search: rawSearch,
  status: rawStatus,
}: {
  role: LearningRole;
  dashboard?: boolean;
  search?: string;
  status?: string;
}) {
  const teacher = role === "teacher";
  const search = (rawSearch ?? "").trim().slice(0, 120);
  const status = (rawStatus ?? "").trim();
  const [{ user }, allRows, studentMaterials] = await Promise.all([
    requireSession(role),
    classroomData<Classroom[]>(role),
    !teacher && dashboard
      ? classroomData<StudentMaterial[]>("student", "/student/materials")
      : Promise.resolve([]),
  ]);
  const active = allRows.filter((row) => !row.is_archived);
  const completedMaterialsCount = studentMaterials.filter(
    (m) => m.progress?.completed,
  ).length;

  const rows = allRows.filter((row) => {
    if (dashboard) return true;
    if (search) {
      const s = search.toLowerCase();
      const matchName = row.name.toLowerCase().includes(s);
      const matchSubject = (row.subject || "").toLowerCase().includes(s);
      const matchDesc = (row.description || "").toLowerCase().includes(s);
      if (!matchName && !matchSubject && !matchDesc) return false;
    }
    if (status === "active" && row.is_archived) return false;
    if (status === "archived" && !row.is_archived) return false;
    return true;
  });

  const hasActiveFilters = Boolean(!dashboard && (search || status));
  return (
    <>
      <Heading
        icon={
          teacher ? (
            dashboard ? (
              <LayoutDashboard size={24} aria-hidden="true" />
            ) : (
              <Users size={24} aria-hidden="true" />
            )
          ) : undefined
        }
        title={
          dashboard ? (
            <><UiText>{"Halo, "}</UiText> {user.full_name}.</>
          ) : teacher ? (
            <UiText>{"Kelas"}</UiText>
          ) : (
            <UiText>{"Kelas Saya"}</UiText>
          )
        }
        description={
          dashboard
            ? teacher
              ? <UiText>{"Kelola kelas, materi, dan tugas siswa."}</UiText>
              : <UiText>{"Buka materi, tanyakan pada Tutor, dan lanjutkan belajarmu."}</UiText>
            : teacher
              ? <UiText>{"Materi, anggota, dan ruang belajar Anda dalam satu tempat."}</UiText>
              : <UiText>{"Daftar semua kelas yang kamu ikuti. Buka kelas untuk melihat materi dan belajar."}</UiText>
        }
      >
        {teacher && (
          <Link className="button primary" href="/guru/kelas/baru">
            <Plus size={17} aria-hidden="true" /><UiText>{"Buat kelas"}</UiText></Link>
        )}
      </Heading>
      {dashboard && (
        <>
          <section className="learning-hero">
            <div>
              <h2>
                {teacher
                  ? <UiText>{"Siapkan kelas dan materi belajar."}</UiText>
                  : <UiText>{"Lanjutkan belajar dari kelasmu."}</UiText>}
              </h2>
              <p>
                {teacher
                  ? <UiText>{"Siapkan materi, ajak siswa, dan bangun pengalaman belajar yang lebih terarah."}</UiText>
                  : <UiText>{"Buka kelas Anda, pilih materi, dan belajar sesuai ritme yang nyaman."}</UiText>}
              </p>
              <Link
                href={`${baseFor(role)}/kelas`}
                className="button learning-hero-button"
              ><UiText>{"Jelajahi kelas"}</UiText><ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            </div>
            <div className="learning-orbit" aria-hidden="true">
              <BookOpen size={68} strokeWidth={1} />
            </div>
          </section>
          <div className="learning-stats">
            {[
              { title: "Kelas aktif", value: active.length, icon: Layers3 },
              {
                title: teacher ? "Materi di kelas aktif" : "Materi tersedia",
                value: active.reduce((sum, row) => sum + row.material_count, 0),
                icon: BookOpen,
              },
              {
                title: teacher ? "Keanggotaan siswa" : "Materi selesai",
                value: teacher
                  ? active.reduce((sum, row) => sum + row.member_count, 0)
                  : completedMaterialsCount,
                icon: teacher ? Users : CheckCircle2,
              },
            ].map(({ title, value, icon: Icon }) => (
              <div className="panel learning-stat" key={title}>
                <Icon size={21} aria-hidden="true" />
                <span>
                  <UiText>{title}</UiText>
                  <strong>{value}</strong>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {dashboard && !teacher && <StudentOverview />}
      {/* Search and filter toolbar for full class catalog */}
      {teacher && !dashboard && (
        <form className="filters" action="/guru/kelas">
          <div className="field search-field">
            <label htmlFor="search" className="sr-only">
              <UiText>{"Cari nama kelas atau mata pelajaran"}</UiText>
            </label>
            <div className="search-input-wrapper">
              <Search size={18} className="search-input-icon" aria-hidden="true" />
              <Input
                name="search"
                id="search"
                defaultValue={search}
                maxLength={120}
                placeholder="Cari nama kelas, mapel, atau deskripsi..."
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
              <option value="active"><UiText>{"Aktif"}</UiText></option>
              <option value="archived"><UiText>{"Diarsipkan"}</UiText></option>
            </NativeSelect>
          </div>

          <button className="button primary search-submit-btn" type="submit">
            <Search size={15} aria-hidden="true" />
            <UiText>{"Cari"}</UiText>
          </button>

          {hasActiveFilters && (
            <Link href="/guru/kelas" className="filter-reset-btn">
              <RotateCcw size={14} aria-hidden="true" />
              <UiText>{"Reset filter"}</UiText>
            </Link>
          )}
        </form>
      )}

      <div className="learning-section-heading">
        <h2>{dashboard ? <UiText>{"Ruang belajar terbaru"}</UiText> : <UiText>{"Semua ruang belajar"}</UiText>}</h2>
        <span>{rows.length}<UiText>{" kelas"}</UiText></span>
      </div>
      {rows.length ? (
        <ClassCards rows={dashboard ? rows.slice(0, 6) : rows} role={role} />
      ) : hasActiveFilters ? (
        <section className="panel">
          <Empty title={<UiText>{"Kelas tidak ditemukan"}</UiText>}>
            <div style={{ display: "grid", gap: "1rem", justifyItems: "center" }}>
              <UiText>{"Tidak ada kelas yang sesuai dengan pencarian atau filter yang dipilih."}</UiText>
              <Link href={`${baseFor(role)}/kelas`} className="button secondary">
                <RotateCcw size={15} aria-hidden="true" />
                <UiText>{"Hapus filter"}</UiText>
              </Link>
            </div>
          </Empty>
        </section>
      ) : (
        <ClassCards rows={[]} role={role} />
      )}
      {dashboard && rows.length > 6 && (
        <Link className="learning-back" href={`${baseFor(role)}/kelas`}><UiText>{"Lihat semua kelas"}</UiText><ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      )}
    </>
  );
}
export async function ClassRoom({
  role,
  id,
}: {
  role: LearningRole;
  id: string;
}) {
  const row = await classroomData<ClassDetail>(
    role,
    `/${encodeURIComponent(id)}`,
  );
  const teacher = role === "teacher";
  const subjects = teacher ? await backend<CurriculumSubject[]>("/subjects", (await requireSession("teacher")).token) : [];
  return (
    <>
      <BackToClasses role={role} />
      <Heading
        title={row.name}
        description={row.description || `Ruang belajar ${row.subject}.`}
      >
        {teacher && (
          <ClassAction
            classId={id}
            mode={row.is_archived ? "restore" : "archive"}
          />
        )}
      </Heading>
      <div className="class-meta">
        <span className="class-subject-badge">
          <BookOpenCheck size={14} aria-hidden="true" />
          <span>{row.subject}</span>
        </span>
        {row.is_archived && (
          <span className="class-status-badge archived">
            <UiText>{"Diarsipkan"}</UiText>
          </span>
        )}
        <span><UiText>{"Guru: "}</UiText>{row.teacher_name}</span>
        <span>{row.member_count}<UiText>{" siswa"}</UiText></span>
      </div>
      {row.is_archived && (
        <p className="info-note"><UiText>{"Kelas ini diarsipkan. Aktifkan kembali untuk mengelola anggota dan materi."}</UiText></p>
      )}
      {teacher && !row.is_archived && (
        <details className="panel" style={{ marginBlock: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            <UiText>{"Pengaturan mata pelajaran kelas"}</UiText>
          </summary>
          <div style={{ marginTop: "1rem" }}>
            <ClassSubjectForm key={row.subject_id} classId={id} subjectId={row.subject_id} subjects={subjects} />
          </div>
        </details>
      )}
      <div className={`class-detail-grid ${teacher ? "" : "student-detail"}`}>
        <section className="panel learning-section">
          <div className="learning-section-heading">
            <h2><UiText>{"Materi belajar"}</UiText></h2>
            {teacher && !row.is_archived && (
              <Link
                className="button primary"
                href={`/guru/kelas/${id}/materi/baru`}
              >
                <Plus size={16} aria-hidden="true" /><UiText>{"Upload materi"}</UiText></Link>
            )}
          </div>
          {row.materials.length ? (
            <div className="material-list">
              {row.materials.map((material, index) => (
                <Link
                  key={material.id}
                  className="material-row"
                  href={teacher ? `/guru/kelas/${id}/materi/${material.id}` : `/siswa/tutor?class_id=${id}&material_id=${material.id}`}
                  aria-label={
                    teacher
                      ? undefined
                      : `${material.title}. Materi ${index + 1}. Klik untuk mulai belajar bersama Tutor AI.`
                  }
                >
                  <span className="material-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="material-info">
                    <strong>{material.title}</strong>
                    <small>
                      {<UiDate value={material.created_at} />}
                      {teacher
                        ? ` · ${material.published ? "Terbit" : "Draft"}`
                        : <UiText>{" · Buka di Tutor AI"}</UiText>}
                    </small>
                  </span>
                  <ArrowUpRight size={20} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title={<UiText>{"Belum ada materi"}</UiText>}>
              {teacher
                ? <UiText>{"Mulai dengan satu penjelasan sederhana. Simpan draft atau langsung terbitkan untuk siswa."}</UiText>
                : <UiText>{"Guru belum menerbitkan materi untuk kelas ini. Silakan tanyakan kepada gurumu."}</UiText>}
            </Empty>
          )}
        </section>
        {teacher && (
          <section className="panel learning-section">
            <h2><UiText>{"Anggota kelas"}</UiText>{" "}
              <span className="muted">({row.members.length})</span>
            </h2>
            {!row.is_archived && <MemberPicker classId={id} />}
            <div className="member-list">
              {row.members.map((member) => (
                <div className="member-row" key={member.id}>
                  <div>
                    <strong>{member.full_name}</strong>
                    <small>
                      @{member.username}
                      {!member.is_active ? <UiText>{" · Nonaktif"}</UiText> : ""}
                    </small>
                  </div>
                  {!row.is_archived && (
                    <ClassAction
                      classId={id}
                      mode="remove-member"
                      studentId={member.id}
                      name={member.full_name}
                    />
                  )}
                </div>
              ))}
            </div>
            {!row.members.length && (
              <p className="muted"><UiText>{"Belum ada anggota. Tambahkan siswa menggunakan username akunnya."}</UiText></p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
export async function MaterialPage({
  role,
  id,
  materialId,
}: {
  role: LearningRole;
  id: string;
  materialId: string;
}) {
  const [row, material, preferences] = await Promise.all([
    classroomData<ClassDetail>(role, `/${encodeURIComponent(id)}`),
    classroomData<Material>(
      role,
      `/${encodeURIComponent(id)}/materials/${encodeURIComponent(materialId)}`,
    ),
    role === "student" ? readingSettings() : Promise.resolve(readingDefaults),
  ]);
  const { token } = await requireSession(role);
  const [mapping, concepts]: [MaterialMapping | null, CurriculumConcept[]] = role === "teacher" && !row.is_archived ? await Promise.all([
    backend<MaterialMapping>(`/classes/${id}/materials/${materialId}/concepts`, token),
    row.subject_id ? backend<CurriculumConcept[]>(`/subjects/${row.subject_id}/concepts`, token) : Promise.resolve([]),
  ]) : [null, []];
  return (
    <>
      <Link className={`learning-back ${role === "student" ? "student-back-link" : ""}`} href={`${baseFor(role)}/kelas/${id}`}>
        <ArrowLeft size={16} aria-hidden="true" />
        {row.name}
      </Link>
      <Heading
        title={material.title}
        description={`${row.subject} · ${row.teacher_name} · ${dateLabel(material.created_at)}`}
      />
      {role === "teacher" && !row.is_archived ? (
        <>
          <MaterialForm classId={id} material={material} />
          {mapping && (
            <details className="panel" style={{ marginTop: "1.5rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                <UiText>{"Pengaturan lanjutan (Konsep pembelajaran)"}</UiText>
              </summary>
              <MaterialConceptsForm key={`${mapping.content_version}:${mapping.mapping_version}:${mapping.subject_id}`} classId={id} mapping={mapping} concepts={concepts} />
            </details>
          )}
        </>
      ) : role === "student" ? (
        <StudentReader
          key={material.id}
          classId={id}
          material={material}
          preferences={preferences}
        />
      ) : (
        <article className="panel material-reader" aria-label="Isi materi">
          <MaterialRenderer document={material.document??legacyMaterialDocument(material.content??"")} classId={id}/>
        </article>
      )}
    </>
  );
}
