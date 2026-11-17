type BoltDataPlanningInput = {question:string;target:string;columns:{name:string;type:'numeric'|'categorical'|'date'|'text'}[]};
type BoltDataPlanResponse = {plan:import('./ask-data.mjs').QuestionPlan;model:string;
  usage:{prompt_tokens:number;completion_tokens:number;cached_tokens:number}};
type BoltModelInput = {endpoint:string;model:string;auth_mode:'bearer'|'apim'|'none';token:string;timeout_seconds:number};
type BoltModelStatus = {configured:boolean;verified:boolean;endpoint:string;model:string;
  auth_mode:'bearer'|'apim'|'none';timeout_seconds:number;has_key:boolean;persisted:boolean;notice:string};

interface Window {
  boltApi?: {
    planData:(input:BoltDataPlanningInput)=>Promise<BoltDataPlanResponse>;
    modelSettings: (operation:'get'|'save'|'test'|'disconnect', settings?:BoltModelInput) => Promise<BoltModelStatus>;
    request: (path: string, options?: {method?: 'GET' | 'POST'; body?: string}) =>
      Promise<{ok: boolean; status: number; data: unknown}>;
    saveArtifact: (artifactId: string, sessionId: string, filename: string) =>
      Promise<{saved: boolean}>;
  };
}
