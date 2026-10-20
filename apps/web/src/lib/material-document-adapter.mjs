const kinds=new Set(["heading","paragraph","list","table","image","math"]);
const fields=new Set("id type role review_state review_origin confidence provenance inlines level ordered items headers rows asset_id alt caption decorative latex warnings".split(" "));
const inlineFields=new Set(["type","text","latex","marks","href"]);
const marks={strong:"bold",emphasis:"italic",subscript:"subscript",superscript:"superscript"};
const reverse=Object.fromEntries(Object.entries(marks).map(([key,value])=>[value,key]));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy=value=>structuredClone(value);
const semantic=value=>Array.isArray(value)?value.map(semantic):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key,v])=>v!==null&&v!==false&&v!==""&&!(Array.isArray(v)&&!v.length)&&!(key==="type"&&v==="text")).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,semantic(v)])):value;
const ownKeys=(object,allowed)=>{if(!object||typeof object!=="object"||Array.isArray(object)||Object.keys(object).some(key=>!allowed.has(key)))throw Error("Format materi tidak didukung.");};
const safeText=value=>{if(typeof value!=="string"||/<\s*\/?\s*[a-zA-Z][^>]*>|<!--|\u0000/.test(value))throw Error("Gunakan teks tanpa HTML.");return value;};
const commands=new Set("frac dfrac tfrac sqrt sum prod int lim sin cos tan log ln exp pi theta alpha beta gamma delta epsilon lambda mu sigma omega Delta Omega Gamma left right cdot times div pm mp le ge leq geq neq approx infty in notin subset subseteq cup cap to overline underline vec hat bar text mathrm mathbf mathit operatorname begin end matrix pmatrix bmatrix aligned cases quad qquad displaystyle small tiny degrees circ binom boxed hline".split(" "));
export function validateMaterialLatex(value){safeText(value);if(value.length>4000||[...value.matchAll(/\\([a-zA-Z]+)/g)].some(m=>!commands.has(m[1]))||/https?:|javascript:/i.test(value)||(value.match(/\{/g)||[]).length!==(value.match(/\}/g)||[]).length)throw Error("Rumus belum valid atau perintahnya tidak didukung.");return value;}
function validateInline(node){ownKeys(node,inlineFields);if(node.type&&!["text","math"].includes(node.type))throw Error("Jenis teks tidak didukung.");if(node.type==="math"){validateMaterialLatex(node.latex);return;}safeText(node.text??"");if(node.marks?.some(mark=>!marks[mark]))throw Error("Format teks tidak didukung.");if(node.href){const url=new URL(node.href);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw Error("Tautan tidak valid.");}}
export function validateMaterialDocument(input){
 ownKeys(input,new Set(["schema_version","blocks"]));
 if(input.schema_version!==1||!Array.isArray(input.blocks)||input.blocks.length>5000||new TextEncoder().encode(JSON.stringify(input)).length>2*1024*1024)throw Error("Dokumen terlalu besar atau versinya tidak didukung.");
 const ids=new Set();let length=0;
 for(const block of input.blocks){ownKeys(block,fields);if(!kinds.has(block.type)||!/^[-\w]{1,100}$/.test(block.id)||ids.has(block.id))throw Error("Blok materi tidak valid.");ids.add(block.id);
  for(const node of [...(block.inlines??[]),...(block.items??[]).flat()]){validateInline(node);length+=(node.text??node.latex??"").length;}
  for(const text of [...(block.headers??[]),...(block.rows??[]).flat(),block.alt??"",block.caption??""]){safeText(text);length+=text.length;}
  if(block.type==="math"){validateMaterialLatex(block.latex);length+=block.latex.length;}
  if(block.type==="table"&&(!block.headers?.length||block.rows?.some(row=>row.length!==block.headers.length)))throw Error("Baris tabel harus sesuai header.");
  if(block.type==="image"&&(!uuid.test(block.asset_id??"")||((block.review_state??"accepted")==="accepted"&&!block.decorative&&!block.alt?.trim())))throw Error("Gambar memerlukan aset dan deskripsi alternatif.");
  if(block.review_state&&!["accepted","needs_review","excluded"].includes(block.review_state))throw Error("Status tinjauan tidak valid.");
 }
 if(length>100000)throw Error("Materi maksimal 100.000 karakter.");return copy(input);
}
export function legacyMaterialDocument(text){const blocks=[];for(const [index,part] of text.replace(/<!--[\s\S]*?-->/g,"").replace(/<[^>]*>/g,"").split(/\n\s*\n/).entries()){if(!part.trim())continue;const heading=/^(#{1,6})\s+([^\n]+)$/.exec(part.trim());blocks.push({id:`legacy-${index}`,type:heading?"heading":"paragraph",...(heading?{level:heading[1].length}:{}),inlines:[{text:heading?heading[2]:part.trim()}],review_origin:"legacy_unverified",provenance:{method:"legacy"}});}return {schema_version:1,blocks};}
function inlineToEditor(nodes){return nodes.filter(n=>n.type==="math"||n.text).map(node=>node.type==="math"?{type:"inlineMath",attrs:{latex:node.latex}}:{type:"text",text:node.text,...((node.marks?.length||node.href)?{marks:[...(node.marks??[]).map(mark=>({type:marks[mark]})),...(node.href?[{type:"link",attrs:{href:node.href}}]:[])]}:{})});}
function inlineFromEditor(nodes=[]){return nodes.flatMap(node=>{if(node.type==="inlineMath")return [{type:"math",latex:node.attrs?.latex}];if(node.type==="hardBreak")return [{text:"\n"}];if(node.type!=="text")throw Error("Jenis teks editor tidak didukung.");const styles=node.marks??[];if(styles.some(mark=>!reverse[mark.type]&&mark.type!=="link"))throw Error("Format teks editor tidak didukung.");return [{text:node.text??"",...(styles.some(mark=>reverse[mark.type])?{marks:styles.filter(mark=>reverse[mark.type]).map(mark=>reverse[mark.type])}:{}),...(styles.some(mark=>mark.type==="link")?{href:styles.find(mark=>mark.type==="link").attrs?.href}:{})}];});}
function scientificInline(text){const result=[];let start=0;for(const match of text.matchAll(/([_^])\{([^{}]*)\}/g)){if(match.index>start)result.push({text:text.slice(start,match.index)});result.push({text:match[2],marks:[match[1]==="_"?"subscript":"superscript"]});start=match.index+match[0].length;}if(start<text.length)result.push({text:text.slice(start)});return result;}
function scientificText(nodes){return inlineFromEditor(nodes).map(n=>{if(n.type==="math")return n.latex;let text=n.text;for(const mark of n.marks??[])if(mark==="subscript"||mark==="superscript")text=`${mark==="subscript"?"_":"^"}{${text}}`;return text;}).join("");}
export function toEditorJson(input,{classId=""}={}){
 const document=validateMaterialDocument(input);
 return {type:"doc",content:document.blocks.map(block=>{const attrs={materialMeta:copy(block)};
  if(["paragraph","heading"].includes(block.type))return {type:block.type,attrs:{...attrs,...(block.type==="heading"?{level:block.level??2}:{})},content:inlineToEditor(block.inlines??[])};
  if(block.type==="math")return {type:"blockMath",attrs:{...attrs,latex:block.latex}};
  if(block.type==="image")return {type:"image",attrs:{...attrs,assetId:block.asset_id,src:`/api/classes/${classId}/material-assets/${block.asset_id}`,alt:block.alt??"",title:block.caption??""}};
  if(block.type==="list")return {type:block.ordered?"orderedList":"bulletList",attrs,content:(block.items??[]).map(item=>({type:"listItem",content:[{type:"paragraph",content:inlineToEditor(item)}]}))};
  return {type:"table",attrs,content:[{type:"tableRow",content:block.headers.map(text=>({type:"tableHeader",content:[{type:"paragraph",content:inlineToEditor(scientificInline(text))}]}))},...(block.rows??[]).map(row=>({type:"tableRow",content:row.map(text=>({type:"tableCell",content:[{type:"paragraph",content:inlineToEditor(scientificInline(text))}]}))}))]};
 })};
}
export function fromEditorJson(value){
 if(value.type!=="doc"||!Array.isArray(value.content))throw Error("Dokumen editor tidak valid.");
 const ids=new Set();const blocks=value.content.filter(node=>!["paragraph","heading"].includes(node.type)||(node.content?.length??0)>0).map(node=>{
  const original=node.attrs?.materialMeta;const meta=original?copy(original):{};
  for(const key of ["inlines","level","ordered","items","headers","rows","asset_id","alt","caption","decorative","latex"])delete meta[key];
  if(!meta.id||ids.has(meta.id))meta.id=`block-${globalThis.crypto.randomUUID()}`;ids.add(meta.id);
  let payload;
  if(["paragraph","heading"].includes(node.type))payload={type:node.type,inlines:inlineFromEditor(node.content),...(node.type==="heading"?{level:node.attrs?.level??2}:{})};
  else if(node.type==="blockMath")payload={type:"math",latex:node.attrs?.latex};
  else if(node.type==="image"){
   const aid=node.attrs?.assetId??original?.asset_id;
   if(!uuid.test(aid??"")||!new RegExp(`^/api/classes/${uuid.source.slice(1,-1)}/material-assets/${aid}$`,"i").test(node.attrs?.src??""))throw Error("Unggah gambar melalui aset kelas.");
   payload={type:"image",asset_id:aid,alt:node.attrs?.alt??"",...(original?.caption||node.attrs?.title?{caption:node.attrs?.title??original.caption}:{}),...(original?.decorative!==undefined?{decorative:original.decorative}:{})};
  }else if(["orderedList","bulletList"].includes(node.type))payload={type:"list",...(node.type==="orderedList"||original?.ordered!==undefined?{ordered:node.type==="orderedList"}:{}),items:(node.content??[]).map(item=>{if(item.type!=="listItem"||item.content?.some(child=>child.type!=="paragraph"))throw Error("Gunakan daftar tanpa tingkat bersarang.");return inlineFromEditor(item.content?.flatMap(child=>child.content??[]));})};
  else if(node.type==="table"){
   const rows=node.content??[];if(!rows.length||rows[0].content?.some(cell=>cell.type!=="tableHeader"))throw Error("Tabel memerlukan baris header.");
   const text=cell=>scientificText(cell.content?.flatMap(p=>p.content??[]));
   payload={type:"table",headers:rows[0].content.map(text),rows:rows.slice(1).map(row=>row.content.map(text))};
  }else throw Error("Blok editor tidak didukung.");
  const block={...meta,...payload};if(original){const before=copy(original);const after=copy(block);delete before.provenance;delete after.provenance;if(JSON.stringify(semantic(before))!==JSON.stringify(semantic(after)))block.provenance={...original.provenance,edited:true};else return original;}
  return block;
 });return validateMaterialDocument({schema_version:1,blocks});
}
export function materialPlainText(document){const inline=nodes=>(nodes??[]).map(n=>n.type==="math"?speech(n.latex):(n.marks??[]).reduce((text,mark)=>mark==="superscript"?` pangkat ${text} `:mark==="subscript"?` subskrip ${text} `:text,n.text??"")).join("");return validateMaterialDocument(document).blocks.filter(b=>b.review_state!=="excluded").map(b=>b.type==="math"?speech(b.latex):b.type==="image"?b.alt??"":b.type==="table"?(b.rows??[]).map(row=>b.headers.map((h,i)=>`${h}: ${speech(row[i])}`).join("; ")).join(". "):b.type==="list"?(b.items??[]).map(inline).join(". "):inline(b.inlines)).join("\n\n");}
function speech(value){return (value??"").replace(/\\(?:dfrac|tfrac|frac)\{([^{}]*)\}\{([^{}]*)\}/g,"$1 dibagi $2").replace(/\^\{([^{}]*)\}/g," pangkat $1 ").replace(/_\{([^{}]*)\}/g," subskrip $1 ").replace(/\^([a-z\d])/gi," pangkat $1 ").replace(/_([a-z\d])/gi," subskrip $1 ").replace(/\\sqrt/g," akar ").replace(/\\([a-zA-Z]+)/g," $1 ").replace(/[{}]/g,"").replace(/\+/g," tambah ").replace(/=/g," sama dengan ").replace(/\s+/g," ").trim();}
