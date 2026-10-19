import type {GuidanceResponse,ProgressIntent,ProgressIntentInput} from "./progress-guidance-types";
export class ProgressRequestError extends Error {status:number|null; constructor(message:string,status?:number|null);}
export function parseProgressRequest(input:unknown,action:string):{request_id:string;expected_revision:number;timezone?:string};
export function prepareProgressIntent(pending:ProgressIntent|null,input:ProgressIntentInput,createId?:()=>string):ProgressIntent;
export function safePlanDestination(value:unknown):boolean;
export function readProgressMutation(response:Response):Promise<{status:string;destination?:string;revision:number}>;
export function readGuidanceResponse(response:Response):Promise<GuidanceResponse>;
