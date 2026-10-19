import test from "node:test";
import assert from "node:assert/strict";
import {materialLearningLabel} from "../src/lib/quiz-points-display.ts";
test("reading and Tutor completion are independent and version-specific",()=>{
 const material={progress:{completed:true},learning_progress:{status:"not_started",completed_units:0,total_units:3}};
 assert.equal(materialLearningLabel(material.learning_progress,"en"),"Not started with Tutor");
 assert.equal(materialLearningLabel({...material.learning_progress,status:"completed"},"en"),"Completed with Tutor");
});
