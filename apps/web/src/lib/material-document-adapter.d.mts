import type {JSONContent} from "@tiptap/core";
import type {MaterialDocument} from "./material-document-types";
export function validateMaterialDocument(value:unknown):MaterialDocument;
export function validateMaterialLatex(value:string):string;
export function legacyMaterialDocument(value:string):MaterialDocument;
export function toEditorJson(value:MaterialDocument,options?:{classId?:string}):JSONContent;
export function fromEditorJson(value:JSONContent):MaterialDocument;
export function materialPlainText(value:MaterialDocument):string;
