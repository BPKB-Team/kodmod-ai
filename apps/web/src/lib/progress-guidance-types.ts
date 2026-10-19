export type GuidanceInsight = {kind:string; fact_ids:string[]; title:string; body:string};
export type GuidanceStep = {
  id:string; candidate_id?:string; kind:"review_unit"|"practice"|"self_explain";
  status:"pending"|"in_progress"|"completed"|"skipped"|"invalidated";
  title:string; body:string; reason_text:string; estimated_minutes:number; href:string|null;
};
export type GuidanceFocus = Omit<GuidanceStep,"id"|"status"|"kind"> & {id?:string;status?:GuidanceStep["status"];kind?:GuidanceStep["kind"]};
export type StudyPlan = {id:string;cycle_id:string;revision:number;status:"active"|"completed";used_fallback:boolean;steps:GuidanceStep[]};
export type GuidanceResponse = {
  status:"idle"|"updating"|"ready"|"stale"|"completed"|"no_available_material";
  updating:boolean; timezone?:string; as_of:string; source_snapshot_hash:string; needs_refresh:boolean;
  planning_window?:{kind:string;start?:string;end?:string};
  focus:GuidanceFocus|null;plan:StudyPlan|null;insights:GuidanceInsight[];
  empty_action:{href:string;label:string};
};
export type ProgressIntentInput = {action:"refresh"|"start"|"skip";planId?:string;stepId?:string;revision:number;timezone:string};
export type ProgressIntent = Readonly<{scope:string;path:string;body:Readonly<{request_id:string;expected_revision:number;timezone?:string}>}>;
