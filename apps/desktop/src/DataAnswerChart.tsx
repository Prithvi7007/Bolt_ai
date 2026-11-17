import {useId} from 'react';
import {chartLayout,chartNumber,shortLabel,type DataChart} from '../shared/data-chart.mjs';

export default function DataAnswerChart({chart}:{chart:DataChart}) {
  const id=useId(),layout=chartLayout(chart);
  return <figure className="lab-answer-chart">
    <figcaption><strong>{chart.title}</strong><span>X: {chart.xLabel} · Y: {chart.yLabel}</span></figcaption>
    <svg role="img" aria-labelledby={id+'-title '+id+'-description'} viewBox={'0 0 '+layout.width+' '+layout.height} fontFamily="Arial,sans-serif">
      <title id={id+'-title'}>{chart.title}</title>
      <desc id={id+'-description'}>{chart.note} Chart values are calculated locally. Full values are available in the chart-data table.</desc>
      {layout.type==='bar'?<>
        {layout.ticks.map((tick,i)=><g key={i}>
          <path d={'M'+tick.position+' '+layout.top+' V'+layout.bottom} stroke="#334B67" strokeDasharray="3 5"/>
          <text x={tick.position} y={layout.bottom+23} fill="#CBD5E1" fontSize="12" textAnchor="middle">{tick.label}</text>
        </g>)}
        <path d={'M'+layout.zero+' '+layout.top+' V'+layout.bottom} stroke="#A7BDD9"/>
        {layout.bars.map((point,i)=><g key={i}>
          <text x="18" y={point.cy} fill="#CBD5E1" fontSize="13">{shortLabel(point.label)}<title>{point.label}</title></text>
          <rect x={point.x} y={point.y} width={point.width} height={point.height} rx="3" fill={point.value<0?'#C4A1F5':'#60A5FA'}>
            <title>{point.label+': '+point.value+' · '+point.detail}</title>
          </rect>
          <text x="820" y={point.cy} fill="#F8FAFC" fontSize="12">{chartNumber(point.value)}</text>
        </g>)}
      </>:<>
        {layout.ticks.map((tick,i)=><g key={i}>
          <path d={'M'+layout.left+' '+tick.position+' H'+layout.right} stroke="#334B67" strokeDasharray="3 5"/>
          <text x="78" y={tick.position+4} fill="#CBD5E1" fontSize="12" textAnchor="end">{tick.label}</text>
        </g>)}
        <polyline points={layout.points.map(p=>p.cx.toFixed(2)+','+p.cy.toFixed(2)).join(' ')} fill="none" stroke="#60A5FA" strokeWidth="2.5" strokeLinejoin="round"/>
        {layout.points.map((point,i)=><circle key={i} cx={point.cx} cy={point.cy} r="3" fill="#93C5FD">
          <title>{point.label+': '+point.value+' · '+point.detail}</title>
        </circle>)}
        <text x={layout.left} y="298" fill="#CBD5E1" fontSize="12">{layout.points[0].label}</text>
        <text x={layout.right} y="298" fill="#CBD5E1" fontSize="12" textAnchor="end">{layout.points.at(-1)?.label}</text>
      </>}
    </svg>
    <p>{chart.note}</p>
    <details><summary>View chart data ({chart.points.length} points)</summary>
      <p>Chart geometry uses unrounded calculated values. Full numeric values are shown below.</p>
      <div className="lab-chart-table-scroll" role="region" aria-label={'Full chart data: '+chart.title} tabIndex={0}>
        <table><thead><tr><th scope="col">Label</th><th scope="col">Calculated value</th><th scope="col">Evidence</th></tr></thead>
          <tbody>{chart.points.map((point,i)=><tr key={i}><td>{point.label}</td><td>{String(point.value)}</td><td>{point.detail}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </figure>;
}
