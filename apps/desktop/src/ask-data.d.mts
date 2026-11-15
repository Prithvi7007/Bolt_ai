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
};
export function planDataQuestion(question:string,profile:DatasetProfile,approvedTarget:string):QuestionPlan;
export function suggestedDataQuestions(profile:DatasetProfile,target:string):string[];
export function answerDataQuestion(file:File,question:string,profile:DatasetProfile,approvedTarget:string):Promise<DataAnswer>;
