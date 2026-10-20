import type {MaterialDocument} from "./material-document-types";
import type { MaterialSection } from "./material-flow.mjs";
export type MaterialImportPreview = {
  preview_type: "material" | "book"; filename: string; title: string; content: string;
  document?:MaterialDocument;
  total_pages?: number; page_range?: { first: number; last: number } | null;
  sections?: MaterialSection[]; warnings?: string[];
  pages?: { page: number; method: "native" | "ocr" | "mixed"; confidence: number | null; text: string }[];
};
export type MaterialImportRecord = {
  import_id: string; job_id: string; filename: string; state: "pending" | "running" | "retry" | "complete" | "failed";
  attempts: number; error: string | null; sha256: string; size_bytes: number; created_at: string;
  preview: MaterialImportPreview | null;
};
