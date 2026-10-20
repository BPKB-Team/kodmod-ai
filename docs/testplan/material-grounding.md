# Material grounding validation

Updated: 20 October 2026.

This plan separates document extraction, source-backed question checks, interaction policy, and access scope. The PDFs and generated reports live under the ignored `.runtime/material-grounding/` directory; only this manifest and reproducible test code belong in Git.

## Public source corpus

| Source | Pages imported | Local SHA-256 | Output and review notes |
| --- | ---: | --- | --- |
| [NASA SpaceMath: Solar System I](https://science.nasa.gov/learn/heat/resource/space-math-at-nasa-math-problems-related-to-the-solar-system-i/) | 2–3 of 42 | `f4f35106a0e9321d6ff0d9d814a851ea0daffd6252afdefcadb528dc18964310` | 3,528 characters, 27 blocks, 2 chunks. Physical page 4 starts the answer key and is intentionally excluded. |
| [NIST Periodic Table of the Elements](https://www.nist.gov/pml/periodic-table-elements) | 1–2 of 2 | `11bb30f912e5efd4961750434a9fe4de9998a4261d04c6fefd4747fdaf9e7d12` | 12,743 characters, 239 blocks, 6 chunks. 148 blocks need review; extracted column order is not reliable for individual cells until a teacher checks it. |
| [NASA Our Solar System poster, Version A](https://science.nasa.gov/resource/our-solar-system-poster-version-a/) | 1 of 1 | `2a356a0570b012b0a9dfd852b4b7013d7fc85b83d438df981bd7555cf89f20bc` | 539 characters, 2 blocks, 1 chunk. Both blocks need review; the diagram and labels require visual description. |
| [USGS Water-Supply Paper 2254, Section 2](https://pubs.usgs.gov/wsp/wsp2254/html/pdf.html) | 5–7 of 33 | `f39b5e68438cc4eeef396e812cb4b46fe39d38a23898ddd6ed482bdf64ac9786` | 12,855 characters, 314 blocks, 6 chunks. 99 blocks need review; the equation around physical page 6 is garbled and must not be treated as a verified answer. |

These are official-source links; the files are private local test inputs, not redistributable corpus assets. NASA material can contain third-party content with separate rights, so reuse must be checked at the asset level before publishing it.

## Extraction and import behavior

`extract_pdf_layout` emits text, tables, image regions, physical page provenance, and review state. The extractor version is `layout-v2`: an image region whose native glyph boxes cover at least 2% of the region is retained for review but not OCRed again. This avoids repeating OCR over PDFs that encode text as many thin image strips plus a readable text layer. Image-only regions still use bounded OCR; low-confidence, formula, table, and image output remains review-required.

The supplied-PDF acceptance test runs the real upload/import/preview/draft/publish/index/read/retrieve routes against a random schema in the dedicated `kodmod_test` PostgreSQL database. It uses simulated embeddings and no live question-generation provider. It verifies selected physical pages, preview without persistence, publish/index completion, chunk versions, retrieval restricted to the authorized class/material, and no outsider result. The test drops only its generated schema.

Latest local import report: `.runtime/material-grounding/import-report.json`. All four samples reached `rag_status=ready`; selected ranges and counts are listed above. The preview content was persisted as plain material text in this acceptance path, so this test proves the import and text retrieval lifecycle, while structured editor/provenance behavior is verified separately by document pipeline tests.

## Deterministic evaluation

`tests/fixtures/material_grounding/manifest.json` contains source metadata and a small synthetic document. The synthetic document checks superscript projection (`a^{p+q}`), chemical subscript and table pairing (`CO(NH_{2})_{2}` / `Urea`), exclusion of a private answer-key block, and provenance. The fixture evaluator reports extraction, evidence recall, question quality, Tutor/assessment flow, and trace privacy separately; it does not call a model.

Latest fixture report: `.runtime/material-grounding/fixture-report.json`. All five metric groups passed. This synthetic result is not evidence that the live provider generates good questions or that the four public PDFs are factually correct.

## Reproduction

Run from the repository root with the dedicated test stack active:

```powershell
docker exec -e PYTHONDONTWRITEBYTECODE=1 -e KODMOD_MATERIAL_TEST_DIR=/src/.runtime/material-grounding/import-batch -e KODMOD_MATERIAL_TEST_REPORT=/tmp/material-grounding-report.json -w /src/apps/ai-engine kodmod-learning-test python -m pytest -p no:cacheprovider -s tests/integration/test_supplied_materials.py -q
docker cp kodmod-learning-test:/tmp/material-grounding-report.json .runtime/material-grounding/import-report.json
docker exec -e PYTHONDONTWRITEBYTECODE=1 -w /src/apps/ai-engine kodmod-learning-test python -m pytest -p no:cacheprovider tests/integration/test_material_grounding.py -q
docker exec -e PYTHONDONTWRITEBYTECODE=1 -w /src/apps/ai-engine kodmod-learning-test python -m scripts.evaluate_material_grounding --mode fixture --output /tmp/material-grounding-evaluation.json
docker cp kodmod-learning-test:/tmp/material-grounding-evaluation.json .runtime/material-grounding/fixture-report.json
```

The importer rejects non-local database URLs and uses a random schema. `scripts.preview_material_backfill` is a read-only comparison tool: it reads the original source and selected pages, then writes only a private draft/diff report under `.runtime/` or the system temp directory. It never replaces a published revision. The optional `live-local` evaluator is capped at three batches of three questions, uses a read-only database transaction, and requires explicit local class/material/student IDs; it was not run for this validation.

## Current verification and limits

- Supplied-PDF import/retrieval acceptance: 1 passed; 78.88 seconds for the four selected samples.
- PDF layout/OCR/material pipeline: 31 passed.
- Grounding fixture, quiz-flow, evidence, retrieval, progress, and student-model unit set: 142 passed.
- StudentModel PostgreSQL read/write suite: 7 passed.
- StudentModel assignment/practice acceptance: 4 passed.
- Planner durable-job PostgreSQL suite: 11 passed.
- API contract, quiz schema, admin trace contract, and provider-usage checks: 38 passed.
- Web Progress/Tutor/quiz contract tests: 32 passed; web typecheck exited 0.
- Ruff check and format check: all 37 changed Python files passed.


## Manual follow-up for the user

- In Tutor mini-quiz, submit a wrong answer and confirm AI feedback explains the reasoning, offers optional help/try-again, and always keeps a direct **Lanjut soal** action.
- In Latihan/Asesmen mandiri, submit a wrong answer and confirm the correct answer or process is shown with a direct next-question action and no forced retry.
- In a teacher-created task, confirm answer explanations still follow the teacher's release policy.
- In an active session, confirm points/counts are shown without statistical percentages; confirm percentages remain on Progres.
- In Progres, check that insights cite visible learning evidence, plan actions open the intended material/session, and stale or removed material cannot be started.
- In the material editor, compare superscripts, subscripts, tables, and image regions against the source PDF; confirm uncertain regions remain review-required until a teacher checks them.
- With keyboard and screen reader, test hover/focus narration, next/skip controls, focus after transition, and equivalent controls on a mobile viewport. Confirm mobile swipe navigation does not swallow form or quiz gestures.

No UI clicks, production database operations, live model calls, or browser/screen-reader checks were performed. Teachers must review the NIST table alignment, the NASA poster labels, and the USGS formula before those regions are used as question evidence. The user will perform visual and device testing.
