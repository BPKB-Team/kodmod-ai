import {createElement,Fragment,type ReactNode} from "react";
import katex from "katex";
import type {MaterialDocument,MaterialInline} from "@/lib/material-document-types";
import {validateMaterialDocument,materialPlainText} from "@/lib/material-document-adapter.mjs";
import "katex/dist/katex.min.css";
import "@/styles/material-editor.css";
function Formula({latex,display=false}:{latex:string;display?:boolean}){
 const label=materialPlainText({schema_version:1,blocks:[{id:"formula",type:"math",latex}]});
 return <span className={display?"material-math display":"material-math"} role="img" aria-label={label}><span aria-hidden="true" dangerouslySetInnerHTML={{__html:katex.renderToString(latex,{trust:false,throwOnError:false,maxExpand:1000,strict:"error",displayMode:display,output:"html"})}}/></span>;
}
function Inlines({value=[]}:{value?:MaterialInline[]}){return value.map((node,index)=>{
 if(node.type==="math")return <Formula key={index} latex={node.latex??""}/>;
 let child:ReactNode=node.text;
 for(const mark of node.marks??[])child=createElement({strong:"strong",emphasis:"em",subscript:"sub",superscript:"sup"}[mark],{},child);
 if(node.href)child=<a href={node.href} rel="noopener noreferrer">{child}</a>;
 return <Fragment key={index}>{child}</Fragment>;
});}
function Cell({value}:{value:string}){const parts=value.split(/([_^]\{[^{}]*\})/g);return parts.map((part,index)=>/^[_^]\{/.test(part)?createElement(part[0]==="_"?"sub":"sup",{key:index},part.slice(2,-1)):<Fragment key={index}>{part}</Fragment>);}
export function MaterialRenderer({document,classId,showReview=false}:{document:MaterialDocument;classId:string;showReview?:boolean}){
 const safe=validateMaterialDocument(document);
 return <div className="material-document">{safe.blocks.filter(b=>showReview||b.review_state!=="excluded").map(block=>{
 const anchor={id:`material-block-${block.id}`,"data-review-state":block.review_state??"accepted"};
 if(block.type==="heading")return createElement(`h${Math.max(2,Math.min(block.level??2,6))}`,{...anchor,key:block.id},<Inlines value={block.inlines}/>);
 if(block.type==="paragraph")return <p key={block.id} {...anchor}><Inlines value={block.inlines}/></p>;
 if(block.type==="math")return <div key={block.id} {...anchor}><Formula latex={block.latex??""} display/></div>;
 if(block.type==="list"){const tag=block.ordered?"ol":"ul";return createElement(tag,{...anchor,key:block.id},block.items?.map((item,i)=><li key={i}><Inlines value={item}/></li>));}
 if(block.type==="table")return <div key={block.id} {...anchor} className="material-table-scroll"><table><thead><tr>{block.headers?.map((h,i)=><th key={i} scope="col"><Cell value={h}/></th>)}</tr></thead><tbody>{block.rows?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><Cell value={cell}/></td>)}</tr>)}</tbody></table></div>;
 return <figure key={block.id} {...anchor}>
 {/* Private authenticated asset endpoint; keep the session cookie and original dimensions. */}
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={`/api/classes/${classId}/material-assets/${block.asset_id}`} alt={block.decorative?"":block.alt||"Gambar sumber belum dideskripsikan"} loading="lazy"/>{block.caption&&<figcaption>{block.caption}</figcaption>}</figure>;
 })}</div>;
}
