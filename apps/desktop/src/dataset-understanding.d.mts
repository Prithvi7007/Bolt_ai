export type ColumnProfile = {
  name: string;
  type: 'numeric' | 'date' | 'categorical' | 'text';
  missing: number;
  missingPct: number;
  distinctObserved: number;
  distinctCapped: boolean;
  examples: string[];
  min: number | null;
  max: number | null;
  dateCount: number;
};
export type TargetSuggestion = {name: string; score: number; reason: string};
export type DatasetProfile = {
  fileName: string;
  rowCount: number;
  rejectedRows: number;
  columns: ColumnProfile[];
  preview: string[][];
  suggestedTargets: TargetSuggestion[];
  dateColumn: string | null;
  timeGrain: string | null;
  observations: string[];
  processing: string;
};
export function profileCsvText(text: string, filename?: string): DatasetProfile;
export function profileCsvFile(file: File): Promise<DatasetProfile>;
