import test from "node:test";
import assert from "node:assert/strict";
import { prepareQuizAction, readQuizInteraction, quizUiState } from "../src/lib/quiz-actions.mjs";
import { readQuizSubmissionResponse } from "../src/lib/quiz-submission.mjs";
const id="10000000-0000-4000-8000-000000000001";
const question={ question_id:id, order_index:0, question:"Hitung 2²", question_type:"spoken", options:[], difficulty:"easy" };
const review={ policy_version:2, question_state:"review", available_actions:["advance"], current_question:null, review_question:question, last_review:"Jawaban benar: 4.", hint_text:null };
test("wrong assessment review has only advance and survives recovery", async()=>{
 assert.deepEqual(quizUiState(review), {phase:"review", canAnswer:false, canHint:false, canAdvance:true});
 const result={...review,score:0,is_correct:false,feedback:review.last_review,next_question:null,quiz_complete:false,final_summary:null,cumulative_score:0};
 assert.deepEqual(await readQuizSubmissionResponse(Response.json(result)),result);
 assert.deepEqual(await readQuizInteraction(Response.json(review)),review);
});
test("Tutor help is optional and always includes direct advance",()=>{
 assert.deepEqual(quizUiState({...review,question_state:"answering",available_actions:["answer","hint","advance"]}), {phase:"active",canAnswer:true,canHint:true,canAdvance:true});
});
test("network retry retains the same action ID; another intent cannot replace it",()=>{
 const action=prepareQuizAction(null,{question_id:id,action:"hint"},()=>id);
 assert.equal(prepareQuizAction(action,{question_id:id,action:"hint"},()=>{throw Error("new ID")}),action);
 assert.throws(()=>prepareQuizAction(action,{question_id:id,action:"advance"}),/menunggu/);
});
test("invalid interaction responses cannot unlock a question or release a key",async()=>{
 await assert.rejects(readQuizInteraction(Response.json({...review,question_state:"answering",current_question:null})),/valid/);
 await assert.rejects(readQuizInteraction(Response.json({...review,available_actions:["delete"]})),/valid/);
 assert.deepEqual(quizUiState({...review,question_state:"complete",available_actions:[]}),{phase:"complete",canAnswer:false,canHint:false,canAdvance:false});
});
