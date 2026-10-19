"use client";
import { LoadingStatus } from "./loading-feedback";
import { Spinner } from "./ui/spinner";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

import { UiText, UiDate } from "@/components/language-provider";

import { useRef, useState } from "react";
import { RefreshCw, LockKeyhole } from "lucide-react";
import { editorialRequest } from "@/lib/editorial-client";
import { scheduleLabel, type TeacherResults } from "@/lib/editorial-types";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import { Badge, Empty } from "./ui";
import "@/styles/editorial.css";

export function AssignmentResults({ initial }: { initial: TeacherResults }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  const [closing, setClosing] = useState(false);
  async function refresh(close = false) {
    if (locked.current) return;
    locked.current = true;
    try {
      if (
        close &&
        !(await confirmAction({
          title: "Tutup penugasan?",
          text: "Siswa tidak dapat memulai atau mengirim jawaban baru. Nilai yang sudah diterima tetap tersimpan.",
          confirmText: "Ya, tutup",
          destructive: true,
        }))
      )
        return;
      setBusy(true);
      setClosing(close);
      setError("");
      if (close)
        await editorialRequest(
          `/teacher/assignments/${data.assignment.id}/close`,
          "POST",
        );
      setData(
        await editorialRequest<TeacherResults>(
          `/teacher/assignments/${data.assignment.id}/results`,
        ),
      );
      if (close)
        await notifyResult("Penugasan ditutup. Hasil siswa tetap tersimpan.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Hasil belum dapat dimuat.",
      );
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  return (
    <>
      <LoadingStatus active={busy} label={closing ? "Menutup penugasan…" : "Memuat hasil siswa…"} />
      <div className="editorial-status-bar">
        <Badge active={!data.assignment.is_closed}>
          {data.assignment.is_closed ? <UiText>{"Penugasan ditutup"}</UiText> : <UiText>{"Penugasan aktif"}</UiText>}
        </Badge>
        <span><UiText>{"Dibuka:"}</UiText>{" "}
          {data.assignment.opens_at
            ? scheduleLabel(data.assignment.opens_at)
            : <UiText>{"Langsung"}</UiText>}
        </span>
        <span><UiText>{"Tenggat: "}</UiText>{<UiDate value={data.assignment.due_at} time empty="Tanpa batas waktu" />}</span>
      </div>
      {error && (
        <p role="alert" className="editorial-error">
          {error}
        </p>
      )}
      <div className="learning-stats editorial-result-stats">
        {[
          { label: "Siswa terdaftar", value: data.enrolled_count },
          {
            label: "Sudah mengirim",
            value: `${data.submitted_count}/${data.enrolled_count}`,
          },
          {
            label: "Rata-rata nilai",
            value:
              data.average_score === null
                ? <UiText>{"Belum tersedia"}</UiText>
                : `${data.average_score}/100`,
          },
        ].map((s) => (
          <div className="panel learning-stat" key={s.label}>
            <span>
              <UiText>{s.label}</UiText>
              <strong>{s.value}</strong>
            </span>
          </div>
        ))}
      </div>
      <section className="panel editorial-section">
        <div className="learning-section-heading">
          <h2><UiText>{"Hasil siswa"}</UiText></h2>
          <div className="editorial-toolbar">
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {busy && !closing ? <Spinner /> : <RefreshCw size={16} aria-hidden="true" />}<UiText>{"Perbarui"}</UiText></button>
            <button
              type="button"
              className="button secondary small"
              disabled={busy || data.assignment.is_closed}
              onClick={() => void refresh(true)}
            >
              {busy && closing ? <Spinner /> : <LockKeyhole size={16} aria-hidden="true" />}<UiText>{"Tutup penugasan"}</UiText></button>
          </div>
        </div>
        {data.results.length ? (
          <div className="editorial-table-scroll">
            <Table className="editorial-table">
              <caption className="sr-only"><UiText>{"Hasil anggota aktif kelas "}</UiText>{data.assignment.class_name}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col"><UiText>{"Siswa"}</UiText></TableHead>
                  <TableHead scope="col"><UiText>{"Status"}</UiText></TableHead>
                  <TableHead scope="col"><UiText>{"Nilai"}</UiText></TableHead>
                  <TableHead scope="col"><UiText>{"Dikirim pada"}</UiText></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.results.map((r) => (
                  <TableRow key={r.student_id}>
                    <TableHead scope="row">{r.full_name}</TableHead>
                    <TableCell>
                      <Badge active={r.state === "submitted"}>
                        {r.state === "submitted"
                          ? <UiText>{"Selesai"}</UiText>
                          : r.state === "in_progress"
                            ? <UiText>{"Sedang dikerjakan"}</UiText>
                            : <UiText>{"Belum mulai"}</UiText>}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.score === null ? <UiText>{"Belum dinilai"}</UiText> : `${r.score}/100`}
                    </TableCell>
                    <TableCell>
                      {r.submitted_at
                        ? scheduleLabel(r.submitted_at)
                        : <UiText>{"Belum mengirim"}</UiText>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty title={<UiText>{"Belum ada anggota aktif"}</UiText>}><UiText>{"Tambahkan siswa ke kelas untuk membagikan penugasan ini."}</UiText></Empty>
        )}
        <p className="editorial-help"><UiText>{"Nilai pilihan ganda berbobot sama. Ringkasan ini mengikuti anggota aktif kelas saat ini."}</UiText></p>
      </section>
    </>
  );
}
