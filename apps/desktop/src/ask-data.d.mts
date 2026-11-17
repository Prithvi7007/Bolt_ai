import type {DatasetProfile} from './dataset-understanding.mjs';
export type DataAnswerRow = {label:string; value:string; detail:string};
export type DataAnswer = {
  kind: 'answered' | 'unsupported';
  title: string;
  answer: string;
  table: DataAnswerRow[];
  calculation: string | null;
  evidence: string | null;
  warnings: string[];
  planning?: {workflow?:BoltDataWorkflow;mode:'model'|'local';operation:string;model?:string;usage?:{prompt_tokens:number;completion_tokens:number;cached_tokens:number}};
};
export type QuestionPlan = {
  kind: string;
  target?: string;
  predictor?: string | null;
  dimension?: string;
  dateColumn?: string;
  aggregation?: 'sum'|'mean';
  ranking?: 'top'|'bottom'|null;
  limit?:number;
  error?:string;
  reason?:string;
  aiEligible?:boolean;
};
export function planDataQuestion(question:string,profile:DatasetProfile,approvedTarget:string):QuestionPlan;
export function suggestedDataQuestions(profile:DatasetProfile,target:string):string[];
export function answerDataQuestion(file:File,question:string,profile:DatasetProfile,approvedTarget:string):Promise<DataAnswer>;

export function validateDataPlan(plan:unknown,profile:DatasetProfile,approvedTarget:string):QuestionPlan;
export function answerDataPlan(file:File,plan:QuestionPlan,profile:DatasetProfile,approvedTarget:string):Promise<DataAnswer>;
