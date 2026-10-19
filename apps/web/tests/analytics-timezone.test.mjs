import assert from "node:assert/strict";
import test from "node:test";
import {registerHooks} from "node:module";
import {readFileSync} from "node:fs";
import ts from "typescript";
const boundary={current:{token:"test-only",user:{role:"student"}},calls:[]};
globalThis.analyticsTimezoneBoundary=boundary;
const stubs=new Map([
 ["server-only",""],
 ["next/server","export const NextResponse=Response;"],
 ["@/lib/session","export const session=async()=>globalThis.analyticsTimezoneBoundary.current;"],
 ["@/lib/server-api",`export class BackendError extends Error{};export const backend=async(path)=>{globalThis.analyticsTimezoneBoundary.calls.push(path);return {ok:true};};`],
]);
const hooks=registerHooks({resolve(s,c,next){if(stubs.has(s))return{shortCircuit:true,url:"data:text/javascript,"+encodeURIComponent(stubs.get(s))};if(s.startsWith("@/"))return{shortCircuit:true,url:new URL("../src/"+s.slice(2)+".ts",import.meta.url).href};return next(s,c);},load(url,c,next){if(url.endsWith(".ts"))return{shortCircuit:true,format:"module",source:ts.transpileModule(readFileSync(new URL(url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,c);}});
const summary=await import("../src/app/api/analytics/me/route.ts");
const spoken=await import("../src/app/api/analytics/me/spoken/route.ts");
hooks.deregister();
test("summary and spoken forward the same timezone using self-only paths",async()=>{
 for(const route of [summary,spoken])assert.equal((await route.GET(new Request("http://local?window=today&timezone=Asia%2FJakarta&student_id=other"))).status,200);
 assert.deepEqual(boundary.calls,["/analytics/me?window=today&timezone=Asia%2FJakarta","/analytics/me/spoken?window=today&timezone=Asia%2FJakarta"]);
 assert.equal((await summary.GET(new Request("http://local?timezone=Not/AZone"))).status,422);
 boundary.current=null;
 assert.equal((await summary.GET(new Request("http://local"))).status,401);
});
