import test from "node:test";
import assert from "node:assert/strict";
import { analyticsWindowLabel, masteryLabel, studyTimeLabel } from "../src/lib/analytics-display.mjs";

test("study time uses selected language and carries rounded minutes into hours", () => {
  assert.equal(studyTimeLabel(15, "id"), "15 menit");
  assert.equal(studyTimeLabel(15, "en"), "15 min");
  assert.equal(studyTimeLabel(75, "id"), "1 jam 15 mnt");
  assert.equal(studyTimeLabel(75, "en"), "1 h 15 min");
  assert.equal(studyTimeLabel(59.9, "en"), "1 h");
  assert.equal(studyTimeLabel(119.9, "id"), "2 jam");
  assert.equal(studyTimeLabel(-5, "en"), "0 min");
});

test("nonzero activity under one minute is not shown as zero study time", () => {
  assert.equal(studyTimeLabel(0.2, "id"), "< 1 menit");
  assert.equal(studyTimeLabel(0.2, "en"), "< 1 min");
});

test("mastery and period labels have English text rather than raw codes", () => {
  assert.equal(masteryLabel(0.9, "en"), "Strong progress");
  assert.equal(masteryLabel(0.7, "en"), "Developing");
  assert.equal(masteryLabel(0.5, "en"), "Needs practice");
  assert.equal(masteryLabel(0.2, "en"), "Start with the basics");
  assert.equal(analyticsWindowLabel("all", "en"), "All time");
  assert.equal(analyticsWindowLabel("month", "id"), "30 hari");
});
