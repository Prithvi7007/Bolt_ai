import type {DatasetProfile} from './dataset-understanding.mjs';
import type {DataAnswer} from './ask-data.mjs';
export function schemaPlanningRequest(question:string,profile:DatasetProfile,target:string):BoltDataPlanningInput;
export function answerWithAIPlanning(file:File,question:string,profile:DatasetProfile,target:string,options?:{
  useModel?:boolean;planData?:(input:BoltDataPlanningInput)=>Promise<BoltDataPlanResponse>;
  completeDataRun?:(input:BoltDataRunReceipt)=>Promise<BoltDataPlanResponse>;
  isCurrent?:()=>boolean;
  onPhase?:(phase:'planning'|'calculating'|'confirming')=>void;
}):Promise<DataAnswer>;
