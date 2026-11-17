export type DataChartPoint={label:string;value:number;detail:string};
export type DataChart={type:'bar'|'line';title:string;xLabel:string;yLabel:string;note:string;points:DataChartPoint[]};
export function validateChart(chart:unknown):DataChart;
export function chartNumber(value:number):string;
export function shortLabel(value:string,max?:number):string;
type Tick={value:number;label:string;position:number};
type Base={width:number;height:number;left:number;right:number;top:number;bottom:number;ticks:Tick[]};
export function chartLayout(chart:DataChart):
 (Base&{type:'bar';zero:number;bars:(DataChartPoint&{x:number;y:number;width:number;height:number;cy:number})[]})|
 (Base&{type:'line';points:(DataChartPoint&{cx:number;cy:number})[]});
export function renderChartSvg(chart:DataChart,context?:{sourceName?:string;target?:string;question?:string;calculation?:string|null;evidence?:string|null;warnings?:string[]}):string;
