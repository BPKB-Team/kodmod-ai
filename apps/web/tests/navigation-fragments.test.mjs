import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sourceFiles = [
  "app/page.tsx",
  "app/not-found.tsx",
  "app/error.tsx",
  "app/admin/layout.tsx",
  "App.tsx",
  "components/auth-shell.tsx",
  "components/learning-shell.tsx",
  "components/SkipLink.tsx",
  "components/landing-footer.tsx",
  "components/progress-focus.tsx",
  "components/student-analytics.tsx",
];

test("internal navigation uses English fragment paths with matching targets", async () => {
  const source = (
    await Promise.all(
      sourceFiles.map((file) =>
        readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
      ),
    )
  ).join("\n");
  const homepage = await readFile(
    new URL("../src/app/page.tsx", import.meta.url),
    "utf8",
  );
  const linkedFragments = [
    ...[...source.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]),
    ...[...homepage.matchAll(/\["#([a-z-]+)",\s*"/g)].map((match) => match[1]),
  ];
  const targets = new Set(
    [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
  );

  assert.ok(linkedFragments.length > 0, "navigation fragments should be present");
  assert.deepEqual(
    linkedFragments.filter((fragment) =>
      [
        "konten-utama",
        "tentang",
        "cara-belajar",
        "untuk-guru",
        "pilar-solusi",
        "sponsor",
      ].includes(fragment),
    ),
    [],
    "legacy Indonesian fragment paths should not remain in internal navigation",
  );
  for (const fragment of linkedFragments) {
    assert.ok(targets.has(fragment), `Missing target for #${fragment}`);
  }
});
