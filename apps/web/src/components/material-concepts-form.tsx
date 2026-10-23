"use client";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";


import { useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { approveMaterialConcepts, chooseClassSubject, createCurriculumConcept, createCurriculumSubject } from "@/app/concept-actions";
import type { CurriculumConcept, CurriculumSubject, MaterialMapping } from "@/lib/concept-types";
import { ActionFeedback, useConfirmedAction } from "./action-feedback";
import { UiText } from "./language-provider";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function CreateSubjectForm() {
  const [state, action, pending] = useConfirmedAction(createCurriculumSubject, {
    title: "Tambahkan mata pelajaran?", text: "Mata pelajaran tersedia dalam daftar setelah disimpan.", confirmText: "Tambahkan",
  });
  return <details className="panel" style={{ marginTop: "1rem" }}>
    <summary><UiText>{"Mata pelajaran belum ada?"}</UiText></summary>
    <form action={action} className="form-stack" onReset={event => event.preventDefault()}>
      <label className="field"><UiText>{"Nama mata pelajaran"}</UiText><Input name="name" required maxLength={120} disabled={pending} /></label>
      <ActionFeedback state={state} pending={pending} /><Button loading={pending} loadingText={<UiText>{"Menyimpan…"}</UiText>} disabled={pending}><Plus size={16} aria-hidden="true" /><UiText>{"Tambahkan mata pelajaran"}</UiText></Button>
    </form>
  </details>;
}

export function ClassSubjectForm({ classId, subjectId, subjects }: { classId: string; subjectId?: string | null; subjects: CurriculumSubject[] }) {
  const [state, action, pending] = useConfirmedAction(chooseClassSubject.bind(null, classId), {
    title: "Simpan mata pelajaran kelas?", text: "Perubahan mata pelajaran membuat konsep materi harus ditinjau kembali.", confirmText: "Simpan",
  });
  return <Card className="form-stack" style={{ marginBlock: "1rem" }}><CardHeader><CardTitle><UiText>{"Mata pelajaran kelas"}</UiText></CardTitle></CardHeader><CardContent>
    <form action={action} className="form-stack" onReset={event => event.preventDefault()}>
      <label className="field"><UiText>{"Mata pelajaran"}</UiText><NativeSelect name="subject_id" defaultValue={subjectId || ""} disabled={pending}>
        <option value=""><UiText>{"Belum dipilih"}</UiText></option>{subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.name}</option>)}
      </NativeSelect></label>
      <ActionFeedback state={state} pending={pending} /><Button loading={pending} loadingText={<UiText>{"Menyimpan…"}</UiText>} disabled={pending || !subjects.length}><UiText>{"Simpan mata pelajaran"}</UiText></Button>
    </form>
    <CreateSubjectForm />
  </CardContent></Card>;
}

export function MaterialConceptsForm({ classId, mapping, concepts }: { classId: string; mapping: MaterialMapping; concepts: CurriculumConcept[] }) {
  const [selected, setSelected] = useState(mapping.concepts.map(concept => concept.id));
  const [primary, setPrimary] = useState(mapping.concepts.find(concept => concept.primary)?.id || "");
  const [state, action, pending] = useConfirmedAction(approveMaterialConcepts.bind(null, classId, mapping.material_id), {
    title: "Setujui konsep materi?", text: "Pastikan konsep yang dipilih sesuai dengan isi materi.", confirmText: "Setujui konsep",
  });
  return <Card style={{ marginTop: "1rem" }}><CardHeader><CardTitle><UiText>{"Konsep yang dipelajari"}</UiText></CardTitle>
    <CardDescription><UiText>{"Pilih konsep yang dibahas untuk melihat penguasaan siswa. Periksa pilihan ini lagi setelah isi materi berubah."}</UiText></CardDescription></CardHeader><CardContent>
    {!mapping.subject_id ? <p className="info-note"><UiText>{"Pilih mata pelajaran kelas terlebih dahulu."}</UiText></p> : <>
      <form action={action} className="form-stack" onReset={event => event.preventDefault()}>
        <input type="hidden" name="content_version" value={mapping.content_version} /><input type="hidden" name="mapping_version" value={mapping.mapping_version} />
        <fieldset disabled={pending}><legend><UiText>{"Pilih konsep materi"}</UiText></legend>
          {!concepts.length && <p><UiText>{"Tambahkan konsep pertama untuk mata pelajaran ini."}</UiText></p>}
          {concepts.map(concept => <label className="admin-material-publish" key={concept.id}><input type="checkbox" name="concept_ids" value={concept.id} checked={selected.includes(concept.id)} onChange={event => {
            setSelected(ids => event.target.checked ? [...ids, concept.id] : ids.filter(id => id !== concept.id));
            if (!event.target.checked && primary === concept.id) setPrimary("");
          }} /><span>{concept.name}</span></label>)}
        </fieldset>
        <label className="field"><UiText>{"Konsep utama (opsional)"}</UiText><NativeSelect name="primary_concept_id" value={primary} onChange={event => setPrimary(event.target.value)} disabled={pending}>
          <option value=""><UiText>{"Tanpa konsep utama"}</UiText></option>{concepts.filter(concept => selected.includes(concept.id)).map(concept => <option key={concept.id} value={concept.id}>{concept.name}</option>)}
        </NativeSelect></label>
        <ActionFeedback state={state} pending={pending} /><Button loading={pending} loadingText={<UiText>{"Menyimpan…"}</UiText>} disabled={pending}><CheckCircle2 size={16} aria-hidden="true" /><UiText>{"Setujui konsep"}</UiText></Button>
      </form>
      <CreateConceptForm subjectId={mapping.subject_id} />
    </>}
  </CardContent></Card>;
}

function CreateConceptForm({ subjectId }: { subjectId: string }) {
  const [state, action, pending] = useConfirmedAction(createCurriculumConcept.bind(null, subjectId), {
    title: "Tambahkan konsep?", text: "Konsep baru tetap perlu dipilih dan disetujui untuk materi.", confirmText: "Tambahkan",
  });
  return <details style={{ marginTop: "1rem" }}><summary><UiText>{"Tambahkan konsep baru"}</UiText></summary>
    <form action={action} className="form-stack" onReset={event => event.preventDefault()}>
      <label className="field"><UiText>{"Nama konsep"}</UiText><Input name="name" required maxLength={200} disabled={pending} /></label>
      <label className="field"><UiText>{"Kode konsep"}</UiText><Input name="slug" required maxLength={200} pattern="[a-z0-9][a-z0-9-]*" autoCapitalize="none" disabled={pending} /><small><UiText>{"Gunakan huruf kecil, angka, dan tanda hubung. Contoh: pecahan-senilai."}</UiText></small></label>
      <ActionFeedback state={state} pending={pending} /><Button loading={pending} loadingText={<UiText>{"Menyimpan…"}</UiText>} disabled={pending}><Plus size={16} aria-hidden="true" /><UiText>{"Tambahkan konsep"}</UiText></Button>
    </form>
  </details>;
}
