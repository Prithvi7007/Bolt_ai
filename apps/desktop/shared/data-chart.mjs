/** Shared, dependency-free geometry for calculated Data Lab charts and SVG export. */
const KEYS=['type','title','xLabel','yLabel','points','note'];
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
const bounded=(value,max,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0);
export function validateChart(chart){
  if(!exact(chart,KEYS)||!['bar','line'].includes(chart.type)||!bounded(chart.title,600)
    ||!bounded(chart.xLabel,180)||!bounded(chart.yLabel,180)||!bounded(chart.note,2000)
    ||!Array.isArray(chart.points)||chart.points.length<1||chart.points.length>(chart.type==='bar'?12:512))throw new Error('Invalid calculated chart');
  for(const p of chart.points){
    if(!exact(p,['label','value','detail'])||!bounded(p.label,1000,true)||!bounded(p.detail,2000,true)
      ||typeof p.value!=='number'||!Number.isFinite(p.value))throw new Error('Invalid calculated chart point');
  }
  return chart;
}
export function chartNumber(value){
  if(value===0)return '0';
  return Math.abs(value)>=1e6||Math.abs(value)<0.001?value.toExponential(2):value.toLocaleString('en-US',{maximumSignificantDigits:4});
}
export function chartLayout(input){
  const chart=validateChart(input),values=chart.points.map(p=>p.value);
  const scale=Math.max(...values.map(Math.abs))||1;
  const normalized=values.map(v=>v/scale);
  let low=Math.min(...normalized),high=Math.max(...normalized);
  if(chart.type==='bar'){low=Math.min(0,low);high=Math.max(0,high);}
  if(low===high){low=Math.min(0,low);high=Math.max(0,high);if(low===high){low=-1;high=1;}}
  const fraction=v=>(v/scale-low)/(high-low);
  const ticks=[low,(low+high)/2,high].map(n=>({value:n*scale,label:chartNumber(n*scale)}));
  if(chart.type==='bar'){
    const left=240,right=800,top=28,bottom=top+chart.points.length*40;
    const x=v=>left+fraction(v)*(right-left),zero=x(0);
    return {type:'bar',width:960,height:bottom+68,left,right,top,bottom,zero,
      ticks:ticks.map(t=>({...t,position:x(t.value)})),
      bars:chart.points.map((p,i)=>({...p,x:Math.min(zero,x(p.value)),y:top+i*40+7,
        width:Math.abs(x(p.value)-zero),height:25,cy:top+i*40+25}))};
  }
  const left=90,right=915,top=26,bottom=272;
  const points=chart.points.map((p,i)=>({...p,cx:chart.points.length===1?(left+right)/2:left+i/(chart.points.length-1)*(right-left),
    cy:bottom-fraction(p.value)*(bottom-top)}));
  return {type:'line',width:960,height:344,left,right,top,bottom,points,
    ticks:ticks.map(t=>({...t,position:bottom-fraction(t.value)*(bottom-top)}))};
}
const clean=value=>Array.from(String(value),char=>{
  const code=char.codePointAt(0);
  return code===9||code===10||code===13||(code>=0x20&&code<=0xD7FF)||(code>=0xE000&&code<=0xFFFD)||(code>=0x10000&&code<=0x10FFFF)?char:'\uFFFD';
}).join('');
const escape=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const shortLabel=(value,max=18)=>Array.from(value).length>max?Array.from(value).slice(0,max).join('')+'…':value;
function wrap(value,width){
  return clean(value).split(/\r\n|\r|\n|\u0085|\u2028|\u2029/).flatMap(line=>{
    const chars=Array.from(line),lines=[];for(let i=0;i<chars.length;i+=width)lines.push(chars.slice(i,i+width).join(''));
    return lines.length?lines:[''];
  });
}
export function renderChartSvg(chart,context={}){
  const layout=chartLayout(chart);
  const titles=wrap(chart.title,42),header=18+titles.length*25;
  const notes=[
    chart.note,
    'X axis: '+chart.xLabel+'. Y axis: '+chart.yLabel+'.',
    ...(context.sourceName?['Source file: '+context.sourceName]:[]),
    ...(context.target?['Approved target: '+context.target]:[]),
    ...(context.question?['Question: '+context.question]:[]),
    ...(context.calculation?['Calculation: '+context.calculation]:[]),
    ...(context.evidence?['Coverage: '+context.evidence]:[]),
    ...(context.warnings||[]),
    'Chart geometry uses unrounded calculated values. This is a descriptive result.',
  ].flatMap(text=>wrap(text,72));
  const height=header+layout.height+30+notes.length*18;
  const desc=notes.join('\n');
  const elements=[
    '<title id="chart-title">'+escape(chart.title)+'</title>',
    '<desc id="chart-desc">'+escape(desc)+'</desc>',
    '<metadata>'+escape(JSON.stringify({sourceName:context.sourceName||'',target:context.target||'',question:context.question||''}))+'</metadata>',
    '<rect width="960" height="'+height+'" fill="#0F172A"/>',
    ...titles.map((line,i)=>'<text x="20" y="'+(28+i*25)+'" fill="#F8FAFC" font-size="20" font-family="Arial,sans-serif">'+escape(line)+'</text>'),
    '<g transform="translate(0,'+header+')">',
  ];
  if(layout.type==='bar'){
    for(const t of layout.ticks)elements.push('<path d="M'+t.position+' '+layout.top+' V'+layout.bottom+'" stroke="#334B67" stroke-dasharray="3 5"/><text x="'+t.position+'" y="'+(layout.bottom+23)+'" fill="#CBD5E1" font-size="12" text-anchor="middle">'+escape(t.label)+'</text>');
    elements.push('<path d="M'+layout.zero+' '+layout.top+' V'+layout.bottom+'" stroke="#A7BDD9"/>');
    for(const b of layout.bars)elements.push(
      '<text x="18" y="'+b.cy+'" fill="#CBD5E1" font-size="13">'+escape(shortLabel(b.label))+'<title>'+escape(b.label)+'</title></text>',
      '<rect x="'+b.x+'" y="'+b.y+'" width="'+b.width+'" height="'+b.height+'" rx="3" fill="'+(b.value<0?'#C4A1F5':'#60A5FA')+'"><title>'+escape(b.label+': '+b.value+' · '+b.detail)+'</title></rect>',
      '<text x="820" y="'+b.cy+'" fill="#F8FAFC" font-size="12">'+escape(chartNumber(b.value))+'</text>');
  }else{
    for(const t of layout.ticks)elements.push('<path d="M'+layout.left+' '+t.position+' H'+layout.right+'" stroke="#334B67" stroke-dasharray="3 5"/><text x="78" y="'+(t.position+4)+'" fill="#CBD5E1" font-size="12" text-anchor="end">'+escape(t.label)+'</text>');
    elements.push('<polyline points="'+layout.points.map(p=>p.cx.toFixed(2)+','+p.cy.toFixed(2)).join(' ')+'" fill="none" stroke="#60A5FA" stroke-width="2.5" stroke-linejoin="round"/>');
    for(const p of layout.points)elements.push('<circle cx="'+p.cx+'" cy="'+p.cy+'" r="3" fill="#93C5FD"><title>'+escape(p.label+': '+p.value+' · '+p.detail)+'</title></circle>');
    const first=layout.points[0],last=layout.points.at(-1);
    elements.push('<text x="'+layout.left+'" y="298" fill="#CBD5E1" font-size="12">'+escape(first.label)+'</text>');
    if(layout.points.length>1)elements.push('<text x="'+layout.right+'" y="298" text-anchor="end" fill="#CBD5E1" font-size="12">'+escape(last.label)+'</text>');
  }
  elements.push('<text x="480" y="'+(layout.height-8)+'" text-anchor="middle" fill="#CBD5E1" font-size="12">'+escape(shortLabel(chart.xLabel,50)+' · '+shortLabel(chart.yLabel,50))+'</text>','</g>');
  elements.push(...notes.map((line,i)=>'<text x="20" y="'+(header+layout.height+22+i*18)+'" fill="#CBD5E1" font-size="12" font-family="Arial,sans-serif">'+escape(line)+'</text>'));
  return '<svg xmlns="http://www.w3.org/2000/svg" role="img" font-family="Arial,sans-serif" aria-labelledby="chart-title chart-desc" viewBox="0 0 960 '+height+'">'+elements.join('')+'</svg>';
}
