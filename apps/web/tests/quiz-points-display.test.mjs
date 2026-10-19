import test from "node:test";
import assert from "node:assert/strict";
import {quizPointsLabel,legacyItemPointsLabel,materialLearningLabel} from "../src/lib/quiz-points-display.ts";
const summary={points_earned:200,points_possible:300,points_per_question:100,answered_questions:3,total_questions:3,skipped_questions:0,assisted_questions:0};
test("session points format server totals without percentages or averaging",()=>{
 assert.equal(quizPointsLabel(summary,"id"),"200 / 300 poin");
 assert.equal(quizPointsLabel(summary,"en"),"200 / 300 points");
 assert.equal(legacyItemPointsLabel(.145,"id"),"15 / 100 poin");
});
test("Tutor completion differs from reading, and unknown mastery is not failure",()=>{
 assert.equal(materialLearningLabel({status:"completed",completed_units:3,total_units:3},"id"),"Selesai bersama Tutor");
 assert.equal(materialLearningLabel({status:"in_progress",completed_units:1,total_units:3},"id"),"1 / 3 bagian selesai");
 assert.equal(materialLearningLabel(null,"id"),"Belum mulai bersama Tutor");
});
