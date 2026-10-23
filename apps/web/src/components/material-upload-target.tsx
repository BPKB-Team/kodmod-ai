"use client";
import { NativeSelect } from "@/components/ui/native-select";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import type { Classroom } from "@/lib/class-types";
import { Button } from "./ui/button";
import { UiText } from "./language-provider";

export function MaterialUploadTarget({ classes }: { classes: Classroom[] }) {
  const active = classes.filter((row) => !row.is_archived);
  const [classId, setClassId] = useState(active[0]?.id ?? "");
  const router = useRouter();
  return <form className="panel admin-material-search" onSubmit={(event) => {
    event.preventDefault(); if (classId) router.push(`/teacher/classes/${classId}/materials/new`);
  }}><label className="field"><UiText>{"Pilih kelas tujuan"}</UiText><NativeSelect required value={classId} onChange={(event) => setClassId(event.target.value)}><option value=""><UiText>{"Pilih kelas"}</UiText></option>{active.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.subject}</option>)}</NativeSelect></label><Button type="submit" disabled={!classId}><Upload size={17} aria-hidden="true" /><UiText>{"Unggah materi"}</UiText></Button></form>;
}
