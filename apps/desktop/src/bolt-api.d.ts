type BoltDataPlanningInput = {question:string;target:string;columns:{name:string;type:'numeric'|'categorical'|'date'|'text'}[]};
type BoltDataWorkflow = {engine:'langgraph';run_id:string;
  status:'awaiting_local'|'unsupported'|'completed'|'failed'|'cancelled'|'unconfirmed';
  steps:string[];awaiting_local:boolean};
type BoltDataRunReceipt = {run_id:string;status:'completed'|'failed'|'cancelled'};
type BoltDataPlanResponse = {workflow?:BoltDataWorkflow;plan:import('./ask-data.mjs').QuestionPlan;model:string;
  usage:{prompt_tokens:number;completion_tokens:number;cached_tokens:number}};
type BoltDataExportInput = {format:'html'|'csv'|'pptx';sourceName:string;target:string;question:string;
  interpretation:'local'|'model';
  result:Pick<import('./ask-data.mjs').DataAnswer,'title'|'answer'|'table'|'calculation'|'evidence'|'warnings'>};
type BoltModelInput = {endpoint:string;model:string;auth_mode:'bearer'|'apim'|'none';token:string;timeout_seconds:number};
type BoltModelStatus = {configured:boolean;verified:boolean;endpoint:string;model:string;
  auth_mode:'bearer'|'apim'|'none';timeout_seconds:number;has_key:boolean;persisted:boolean;notice:string};

interface Window {
  boltApi?: {
    planData:(input:BoltDataPlanningInput)=>Promise<BoltDataPlanResponse>;
    completeDataRun:(input:BoltDataRunReceipt)=>Promise<BoltDataPlanResponse>;
    modelSettings: (operation:'get'|'save'|'test'|'disconnect', settings?:BoltModelInput) => Promise<BoltModelStatus>;
    request: (path: string, options?: {method?: 'GET' | 'POST'; body?: string}) =>
      Promise<{ok: boolean; status: number; data: unknown}>;
    saveDataAnswer:(input:BoltDataExportInput)=>Promise<{saved:boolean}>;
    saveArtifact: (artifactId: string, sessionId: string, filename: string) =>
      Promise<{saved: boolean}>;
  };
}
