"use client";
import {useEffect,useRef,useState} from "react";
import {useEditor,EditorContent} from "@tiptap/react";
import {materialEditorExtensions,sanitizeMaterialPaste} from "@/lib/material-editor-extensions";
import {toEditorJson,fromEditorJson,validateMaterialLatex} from "@/lib/material-document-adapter.mjs";
import type {MaterialDocument} from "@/lib/material-document-types";
import {UiText,useI18n} from "./language-provider";
import "katex/dist/katex.min.css";
import "@/styles/material-editor.css";
export function MaterialRichEditor({value,onChange,classId,disabled=false,onValidityChange}:{value:MaterialDocument;onChange:(value:MaterialDocument)=>void;classId:string;disabled?:boolean;onValidityChange?:(valid:boolean)=>void}){
 const {t}=useI18n();const [error,setError]=useState("");const [latex,setLatex]=useState("");const [alt,setAlt]=useState("");const [uploading,setUploading]=useState(false);const latest=useRef(value);const file=useRef<HTMLInputElement>(null);
 const editor=useEditor({extensions:materialEditorExtensions(),content:toEditorJson(value,{classId}),immediatelyRender:false,editable:!disabled,editorProps:{attributes:{role:"textbox","aria-label":t("Isi materi"),"aria-multiline":"true"},transformPastedHTML:sanitizeMaterialPaste},onUpdate:({editor})=>{try{const next=fromEditorJson(editor.getJSON());latest.current=next;onChange(next);setError("");onValidityChange?.(true);}catch(caught){setError(caught instanceof Error?caught.message:t("Periksa format materi."));onValidityChange?.(false);}}});
 useEffect(()=>{editor?.setEditable(!disabled&&!uploading);},[disabled,uploading,editor]);
 useEffect(()=>{if(editor&&JSON.stringify(latest.current)!==JSON.stringify(value)){editor.commands.setContent(toEditorJson(value,{classId}),{emitUpdate:false});latest.current=value;}},[value,classId,editor]);
 const locked=disabled||uploading||!editor;
 function insertMath(display:boolean){if(!editor)return;try{validateMaterialLatex(latex);const selected=editor.state.selection;const node=editor.state.doc.nodeAt(selected.from);if(node?.type.name===(display?"blockMath":"inlineMath")){editor.commands.updateAttributes(node.type.name,{latex});}else if(display)editor.chain().focus().insertBlockMath({latex}).run();else editor.chain().focus().insertInlineMath({latex}).run();setLatex("");setError("");}catch(caught){setError(caught instanceof Error?caught.message:t("Periksa rumus."));}}
 async function upload(selected:File){if(!editor||!alt.trim())return;setUploading(true);setError("");try{if(selected.size>10*1024*1024)throw Error("Gambar maksimal 10 MiB.");const body=new FormData();body.set("file",selected);const response=await fetch(`/api/classes/${classId}/material-assets`,{method:"POST",body});const result=await response.json();if(!response.ok)throw Error(result.message||"Gambar belum dapat diunggah.");editor.chain().focus().insertContent({type:"image",attrs:{assetId:result.id,src:`/api/classes/${classId}/material-assets/${result.id}`,alt:alt.trim()}}).run();setAlt("");}catch(caught){setError(caught instanceof Error?caught.message:t("Gambar belum dapat diunggah."));}finally{setUploading(false);if(file.current)file.current.value="";}}
 const tools:Array<[string,()=>unknown,boolean]>=[
 ["Paragraf",()=>editor?.chain().focus().setParagraph().run(),editor?.isActive("paragraph")??false],
 ["Judul",()=>editor?.chain().focus().toggleHeading({level:2}).run(),editor?.isActive("heading")??false],
 ["Tebal",()=>editor?.chain().focus().toggleBold().run(),editor?.isActive("bold")??false],
 ["Miring",()=>editor?.chain().focus().toggleItalic().run(),editor?.isActive("italic")??false],
 ["Subscript",()=>editor?.chain().focus().unsetSuperscript().toggleSubscript().run(),editor?.isActive("subscript")??false],
 ["Superscript",()=>editor?.chain().focus().unsetSubscript().toggleSuperscript().run(),editor?.isActive("superscript")??false],
 ["Daftar",()=>editor?.chain().focus().toggleBulletList().run(),editor?.isActive("bulletList")??false],
 ["Daftar bernomor",()=>editor?.chain().focus().toggleOrderedList().run(),editor?.isActive("orderedList")??false],
 ["Tabel",()=>editor?.chain().focus().insertTable({rows:3,cols:2,withHeaderRow:true}).run(),false],
 ["Tambah baris",()=>editor?.chain().focus().addRowAfter().run(),false],
 ["Tambah kolom",()=>editor?.chain().focus().addColumnAfter().run(),false],
 ["Batalkan",()=>editor?.chain().focus().undo().run(),false],["Ulangi",()=>editor?.chain().focus().redo().run(),false],
 ];
 return <div className="material-rich-editor" aria-busy={uploading}>
 <div className="material-editor-toolbar" role="group" aria-label={t("Format materi")}>{tools.map(([label,run,active])=><button key={label} type="button" aria-pressed={active} disabled={locked} onClick={()=>run()}>{t(label)}</button>)}</div>
 <EditorContent editor={editor}/>
 <details className="material-editor-insert"><summary><UiText>{"Rumus dan gambar"}</UiText></summary><div className="material-insert-fields">
 <label className="field"><UiText>{"Rumus LaTeX"}</UiText><input value={latex} onChange={e=>setLatex(e.target.value)} disabled={locked} maxLength={4000} placeholder="a^{p+q}"/></label><div className="guided-actions"><button type="button" disabled={locked||!latex.trim()} onClick={()=>insertMath(false)}><UiText>{"Sisipkan rumus sebaris"}</UiText></button><button type="button" disabled={locked||!latex.trim()} onClick={()=>insertMath(true)}><UiText>{"Sisipkan rumus terpisah"}</UiText></button></div>
 <label className="field"><UiText>{"Deskripsi alternatif gambar"}</UiText><input value={alt} onChange={e=>setAlt(e.target.value)} disabled={locked} maxLength={4000}/></label><label className="field"><UiText>{"Unggah gambar"}</UiText><input ref={file} type="file" accept="image/png,image/jpeg,image/webp" disabled={locked||!classId||!alt.trim()} onChange={e=>{const selected=e.target.files?.[0];if(selected)void upload(selected);}}/></label>
 </div></details>
 <p className="muted" role="status"><UiText>{uploading?"Mengunggah gambar…":"Format tersimpan bersama materi. Tinjau hasil sebelum menerbitkan."}</UiText></p>{error&&<p className="alert error-message" role="alert">{t(error)}</p>}
 </div>;
}
