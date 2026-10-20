import {Extension} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import {TableKit} from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
const Meta=Extension.create({name:"materialMetadata",addGlobalAttributes(){return [{types:["paragraph","heading","bulletList","orderedList","table","image","blockMath"],attributes:{materialMeta:{default:null,rendered:false,parseHTML:()=>null}}}];}});
const PrivateImage=Image.extend({addAttributes(){return {...this.parent?.(),assetId:{default:null,rendered:false}};},parseHTML(){return [];}});
export function materialEditorExtensions(){return [StarterKit.configure({blockquote:false,codeBlock:false,code:false,horizontalRule:false,strike:false,underline:false,link:{openOnClick:false,autolink:false}}),Subscript,Superscript,TableKit.configure({table:{resizable:false}}),PrivateImage.configure({allowBase64:false}),Mathematics.configure({katexOptions:{trust:false,throwOnError:false,maxExpand:1000,strict:"error"}}),Meta];}
export function sanitizeMaterialPaste(html:string):string {
 const parsed=new DOMParser().parseFromString(html,"text/html");
 parsed.querySelectorAll("script,style,iframe,object,embed,img,svg,math,form,input,button").forEach(node=>node.remove());
 const allowed=new Set(["P","BR","H1","H2","H3","H4","H5","H6","STRONG","B","EM","I","SUB","SUP","UL","OL","LI","TABLE","THEAD","TBODY","TR","TH","TD","A"]);
 for(const node of Array.from(parsed.body.querySelectorAll("*"))){
  if(!allowed.has(node.tagName)){node.replaceWith(...Array.from(node.childNodes));continue;}
  for(const attr of Array.from(node.attributes))if(!(node.tagName==="A"&&attr.name==="href"&&/^https?:\/\//i.test(attr.value)))node.removeAttribute(attr.name);
 }
 return parsed.body.innerHTML;
}
