import test from "node:test";
import assert from "node:assert/strict";
import {toEditorJson,fromEditorJson,legacyMaterialDocument,validateMaterialDocument,materialPlainText} from "../src/lib/material-document-adapter.mjs";
const image="20000000-0000-4000-8000-000000000001";
const document={schema_version:1,blocks:[
 {id:"p",type:"paragraph",review_state:"needs_review",review_origin:"extracted",provenance:{page:10,method:"native",source_sha256:"a".repeat(64)},inlines:[{text:"CO(NH"},{text:"2",marks:["subscript"]},{text:")"},{text:"2",marks:["subscript"]},{text:" dan a"},{text:"p+q",marks:["superscript"]},{type:"math",latex:"\\frac{a}{b}"}]},
 {id:"m",type:"math",latex:"a^p a^q=a^{p+q}"},
 {id:"t",type:"table",headers:["Rumus","Nama"],rows:[["CO(NH_{2})_{2}","Urea"]]},
 {id:"i",type:"image",asset_id:image,alt:"Planet Bumi mengelilingi Matahari",caption:"Sumber gambar"},
]};
test("editor JSON round trip preserves science, table headers, assets and source review",()=>{
 const json=toEditorJson(document,{classId:image});
 const result=fromEditorJson(json);
 assert.deepEqual(result,document);
 assert.match(materialPlainText(result),/pangkat/);
 assert.match(materialPlainText(result),/subskrip/);
 assert.equal(result.blocks[0].provenance.page,10);
 assert.equal(result.blocks[0].review_state,"needs_review");
});
test("changed source text retains original provenance and is marked edited",()=>{
 const json=toEditorJson(document,{classId:image});
 json.content[0].content[0].text="Perbaikan CO(NH";
 const result=fromEditorJson(json);
 assert.equal(result.blocks[0].provenance.edited,true);
 assert.equal(result.blocks[0].provenance.page,10);
});
test("unknown nodes, unsafe latex, links and unapproved image URLs are refused",()=>{
 assert.throws(()=>validateMaterialDocument({schema_version:1,blocks:[{id:"x",type:"script"}]}));
 assert.throws(()=>fromEditorJson({type:"doc",content:[{type:"image",attrs:{src:"https://evil.test/x.png",alt:"x"}}]}));
 assert.throws(()=>validateMaterialDocument({schema_version:1,blocks:[{id:"x",type:"math",latex:"\\href{javascript:x}{x}"}]}));
 assert.throws(()=>validateMaterialDocument({schema_version:1,blocks:[{id:"x",type:"paragraph",inlines:[{text:"klik",href:"javascript:x"}]}]}));
});
test("legacy comments never duplicate or become executable paste markup",()=>{
 const value=legacyMaterialDocument("<!-- demo -->\n\n# Pangkat\n\nPangkat menyatakan perkalian berulang.");
 assert.doesNotMatch(JSON.stringify(value),/demo|<!--/);
 assert.deepEqual(fromEditorJson(toEditorJson(value)),value);
});
