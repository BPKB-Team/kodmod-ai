import assert from "node:assert/strict";
import test from "node:test";
import {prepareProgressIntent,readGuidanceResponse,safePlanDestination,parseProgressRequest} from "../src/lib/progress-guidance-client.mjs";
const id="10000000-0000-4000-8000-000000000001";
test("ambiguous action retry retains exactly the ID and original revision",()=>{
 const pending=prepareProgressIntent(null,{action:"start",planId:id,stepId:id,revision:3,timezone:"UTC"},()=>id);
 assert.equal(prepareProgressIntent(pending,{action:"start",planId:id,stepId:id,revision:8,timezone:"UTC"}),pending);
 assert.equal(pending.body.expected_revision,3);
 assert.throws(()=>prepareProgressIntent(pending,{action:"skip",planId:id,stepId:id,revision:8,timezone:"UTC"}),/menunggu/);
});
test("destinations and request payloads cannot supply arbitrary paths or actors",()=>{
 assert.equal(safePlanDestination(`/student/tutor?session_id=${id}`),true);
 assert.equal(safePlanDestination(`/student/practice?session_id=${id}`),true);
 for(const url of ["https://evil.test","//evil.test","/admin",`/student/tutor?session_id=${id}&return=https://evil.test`,`/student/latihan?session_id=${id}`])assert.equal(safePlanDestination(url),false);
 assert.throws(()=>parseProgressRequest({request_id:id,expected_revision:0,student_id:id},"start"),/valid/);
});
test("cold start and stale guidance remain usable without fake stats",async()=>{
 const data={status:"idle",updating:false,timezone:"UTC",as_of:"now",source_snapshot_hash:"hash",needs_refresh:true,plan:null,focus:null,insights:[{kind:"baseline",title:"Data awal",body:"Belum dinilai",fact_ids:["coverage"]}],empty_action:{href:"/student/classes",label:"Pilih kelas"}};
 assert.deepEqual(await readGuidanceResponse(Response.json(data)),data);
 await assert.rejects(readGuidanceResponse(Response.json({...data,insights:[...data.insights,...data.insights,...data.insights,...data.insights]})),/valid/);
});
