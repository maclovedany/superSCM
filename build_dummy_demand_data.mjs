import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const outputDir = '/Users/danymac/Projects/test99/outputs/019ff8b7-725b-7b41-99a2-f3b7bc66ee76';
await fs.mkdir(outputDir, { recursive: true });

const wb = Workbook.create();
const sheetNames = ['00_사용안내', '01_OL_2025', '02_SFDC_2025', '03_BulkDeal_2025', '04_실적Trend_2025', '05_수급회의_확정수요', '06_월별요약'];
for (const name of sheetNames) wb.worksheets.add(name);

const c = { navy: '#17365D', blue: '#D9EAF7', lightBlue: '#EEF5FB', green: '#E2F0D9', yellow: '#FFF2CC', border: '#B7C9D6', white: '#FFFFFF' };
function title(s, text, end) { const r=s.getRange(`A1:${end}1`); r.merge(); r.values=[[text]]; r.format={fill:c.navy,font:{bold:true,color:c.white,size:15},horizontalAlignment:'center',verticalAlignment:'center'}; r.format.rowHeight=28; }
function subtitle(s, text, end) { const r=s.getRange(`A2:${end}2`); r.merge(); r.values=[[text]]; r.format={fill:c.lightBlue,font:{italic:true,size:10},wrapText:true,verticalAlignment:'center'}; r.format.rowHeight=30; }
function header(s, range) { const r=s.getRange(range); r.format={fill:c.blue,font:{bold:true},horizontalAlignment:'center',verticalAlignment:'center',wrapText:true,borders:{preset:'all',style:'thin',color:c.border}}; r.format.rowHeight=28; }
function body(s, range) { s.getRange(range).format={verticalAlignment:'center',wrapText:true,borders:{insideHorizontal:{style:'thin',color:c.border},insideVertical:{style:'thin',color:c.border},bottom:{style:'thin',color:c.border}}}; }
function widths(s, map) { for (const [col,w] of Object.entries(map)) s.getRange(`${col}:${col}`).format.columnWidth=w; }
function monthLabel(m) { return `2025-${String(m).padStart(2,'0')}`; }

const items = [
  { model:'PRT-A3-001', item:'PRT-A3-001', name:'A3 Printer Model A', type:'기기', base:96, unit:'EA' },
  { model:'PRT-A4-002', item:'PRT-A4-002', name:'A4 Printer Model B', type:'기기', base:72, unit:'EA' },
  { model:'PRT-A3-003', item:'PRT-A3-003', name:'A3 Printer Model C', type:'기기', base:54, unit:'EA' },
  { model:'PRT-A4-004', item:'PRT-A4-004', name:'A4 Printer Model D', type:'기기', base:41, unit:'EA' },
  { model:'PRT-A3-001', item:'OPT-001', name:'Finisher X', type:'옵션', base:30, unit:'EA' },
  { model:'PRT-A4-002', item:'OPT-002', name:'Common Tray Y', type:'옵션', base:42, unit:'EA' },
  { model:'PRT-A3-003', item:'PART-009', name:'필수 설치 Kit Z', type:'부품', base:24, unit:'EA' },
  { model:'PRT-A4-004', item:'SUP-101', name:'Toner Black', type:'소모품', base:78, unit:'EA' },
];

// 00 사용안내
{ const s=wb.worksheets.getItem('00_사용안내'); title(s,'2025년 수요확정용 더미데이터 안내','F'); subtitle(s,'본 파일은 수요확정 화면 테스트용입니다. 2025년 1월~12월의 OL, SFDC Pipeline, Bulk-deal, 과거 실적 Trend, 수급회의 확정수요 샘플을 포함합니다.','F'); const rows=[['시트','내용','기간','행 수','화면 활용','비고'],['01_OL_2025','영업부서별 출고 Outlook','2025-01~2025-12','144','OL 입력·검증','기종·옵션·부품·소모품 포함'],['02_SFDC_2025','중요 영업 Pipeline','2025-01~2025-12','24','추가수요 검토','확률·상태 포함'],['03_BulkDeal_2025','OL 외 Bulk-deal','2025-01~2025-12','12','사전재고 확보 검토','조건부·확정 혼합'],['04_실적Trend_2025','월별 출고·사용 실적','2025-01~2025-12','96','Trend 비교','기기·옵션·부품·소모품 포함'],['05_수급회의_확정수요','월별 수급회의와 확정수요','2025-01~2025-12','12','수요 확정','확정/조건부/참고/제외 포함'],['06_월별요약','월별 집계 KPI','2025-01~2025-12','12','대시보드 검증','OL·실적·추가수요 요약']]; s.getRange('A4:F10').values=rows; header(s,'A4:F4'); body(s,'A5:F10'); widths(s,{A:24,B:36,C:22,D:12,E:30,F:36}); s.showGridLines=false; s.freezePanes.freezeRows(4); }

// 01 OL
{ const s=wb.worksheets.getItem('01_OL_2025'); title(s,'2025년 영업부서별 OL (출고 Outlook)','L'); subtitle(s,'화면의 OL 입력·검증 테스트용 원천 데이터입니다. 제출월도와 필요월도는 고객 출고 예측월도를 의미합니다.','L'); const rows=[['제출월도','필요월도','영업부서','고객구분','기종코드','품목코드','품목명','구분','OL수량','단위','수요상태','비고']]; const depts=['직판1팀','직판2팀','파트너팀']; const customer=['일반','대형고객','공공']; for(let m=1;m<=12;m++){ for(let i=0;i<items.length;i++){ const it=items[i]; const dept=depts[(m+i)%3]; const qty=Math.max(4,Math.round(it.base*(1+((m%4)-1.5)*0.06)+(i%3)*3)); rows.push([monthLabel(m),monthLabel(m),dept,customer[(m+i)%3],it.model,it.item,it.name,it.type,qty,it.unit,'확정 후보',i===4?'장착율 반영 예정':'']); }} s.getRange(`A4:L${rows.length+3}`).values=rows; header(s,'A4:L4'); body(s,`A5:L${rows.length+3}`); s.getRange(`I5:I${rows.length+3}`).setNumberFormat('#,##0'); widths(s,{A:14,B:14,C:16,D:14,E:18,F:16,G:28,H:12,I:12,J:10,K:14,L:28}); s.showGridLines=false; s.freezePanes.freezeRows(4); }

// 02 SFDC
{ const s=wb.worksheets.getItem('02_SFDC_2025'); title(s,'2025년 SFDC 중요 Pipeline','K'); subtitle(s,'OL 외 추가수요 확인을 위한 영업 Pipeline 샘플입니다. 수주확률과 수요상태를 수급회의에서 검토합니다.','K'); const rows=[['기준월도','Deal ID','고객명','영업부서','기종코드','예상수량','예상출고월도','수주확률','Pipeline상태','발주선행필요','수급회의반영']]; for(let m=1;m<=12;m++){ rows.push([monthLabel(m),`DEAL-25-${String(m).padStart(2,'0')}-A`,`고객사 ${String(m).padStart(2,'0')}A`,'직판1팀','PRT-A3-001',18+(m%4)*6,monthLabel(m+1>12?12:m+1),0.55+(m%4)*0.1,m%3===0?'Proposal':'Negotiation',m%2===0?'Y':'N',m%3===0?'확정 후보':'검토']); rows.push([monthLabel(m),`DEAL-25-${String(m).padStart(2,'0')}-B`,`고객사 ${String(m).padStart(2,'0')}B`,'파트너팀','PRT-A4-002',12+(m%3)*5,monthLabel(m),0.45+(m%5)*0.1,'Qualification','N','참고']); } s.getRange(`A4:K${rows.length+3}`).values=rows; header(s,'A4:K4'); body(s,`A5:K${rows.length+3}`); s.getRange(`H5:H${rows.length+3}`).setNumberFormat('0%'); widths(s,{A:14,B:18,C:20,D:16,E:18,F:12,G:16,H:12,I:16,J:16,K:16}); s.showGridLines=false; s.freezePanes.freezeRows(4); }

// 03 Bulk-deal
{ const s=wb.worksheets.getItem('03_BulkDeal_2025'); title(s,'2025년 OL 외 Bulk-deal 수요','J'); subtitle(s,'대형 거래의 사전 재고 확보 여부와 수주확정 상태를 테스트하기 위한 샘플입니다.','J'); const rows=[['기준월도','Deal ID','고객명','기종코드','예상수량','예상출고월도','수주상태','사전재고확보','발주반영률','결정사유']]; for(let m=1;m<=12;m++){ rows.push([monthLabel(m),`BULK-25-${String(m).padStart(2,'0')}`,`Bulk 고객 ${m}`,'PRT-A3-001',40+(m%3)*20,monthLabel(m),'조건부',m%3===0?'Y':'N',m%3===0?1:0.5,m%3===0?'수급회의 선확보':'수주확정 전 모니터링']); } s.getRange(`A4:J${rows.length+3}`).values=rows; header(s,'A4:J4'); body(s,`A5:J${rows.length+3}`); s.getRange(`I5:I${rows.length+3}`).setNumberFormat('0%'); widths(s,{A:14,B:18,C:20,D:18,E:14,F:16,G:14,H:16,I:14,J:34}); s.showGridLines=false; s.freezePanes.freezeRows(4); }

// 04 Actual trend
{ const s=wb.worksheets.getItem('04_실적Trend_2025'); title(s,'2025년 월별 출고·사용 실적 Trend','I'); subtitle(s,'과거 Trend 비교용 월별 실제 출고·사용량 샘플입니다. 기기와 옵션·부품·소모품 사용량을 구분합니다.','I'); const rows=[['실적월도','기종코드','품목코드','품목명','구분','실제수량','단위','전년동월수량','전년대비증감률']]; for(let m=1;m<=12;m++){ for(let i=0;i<items.length;i++){ const it=items[i]; const actual=Math.max(3,Math.round(it.base*(1+((m%5)-2)*0.045))); const prev=Math.max(2,Math.round(actual*(0.92+((m+i)%4)*0.035))); rows.push([monthLabel(m),it.model,it.item,it.name,it.type,actual,it.unit,prev,null]); }} s.getRange(`A4:I${rows.length+3}`).values=rows; header(s,'A4:I4'); body(s,`A5:I${rows.length+3}`); for(let r=5;r<rows.length+4;r++) s.getRange(`I${r}`).formulas=[[`=IF(H${r}=0,0,(F${r}-H${r})/H${r})`]]; s.getRange(`I5:I${rows.length+3}`).setNumberFormat('0.0%'); widths(s,{A:14,B:18,C:16,D:28,E:12,F:14,G:10,H:16,I:18}); s.showGridLines=false; s.freezePanes.freezeRows(4); }

// 05 meeting confirmation
{ const s=wb.worksheets.getItem('05_수급회의_확정수요'); title(s,'2025년 수급회의 및 확정수요','J'); subtitle(s,'월별 수급회의 결과와 최종 확정수요 샘플입니다. 조건부 수요 반영률과 Bulk-deal 선확보 의사결정을 포함합니다.','J'); const rows=[['회의월도','회의일','참석부서','OL합계','SFDC추가수요','BulkDeal추가수요','조건부반영률','최종확정수요','Bulk선확보','확정상태']]; for(let m=1;m<=12;m++){ const ol=items.slice(0,4).reduce((sum,it)=>sum+Math.round(it.base*(1+((m%4)-1.5)*0.06)),0); const sfdc=18+(m%4)*6; const bulk=40+(m%3)*20; const rate=m%3===0?1:0.5; rows.push([monthLabel(m),`2025-${String(m).padStart(2,'0')}-${String(15+(m%10)).padStart(2,'0')}`,'영업·수급·구매',ol,sfdc,bulk,rate,null,m%3===0?'Y':'N',m<=3?'확정':m<=8?'조건부':'회의 전']); } s.getRange(`A4:J${rows.length+3}`).values=rows; header(s,'A4:J4'); body(s,`A5:J${rows.length+3}`); for(let r=5;r<rows.length+4;r++) s.getRange(`H${r}`).formulas=[[`=D${r}+E${r}+F${r}*G${r}`]]; s.getRange(`G5:G${rows.length+3}`).setNumberFormat('0%'); s.getRange(`D5:H${rows.length+3}`).setNumberFormat('#,##0'); widths(s,{A:14,B:16,C:24,D:14,E:16,F:18,G:16,H:16,I:14,J:14}); s.showGridLines=false; s.freezePanes.freezeRows(4); }

// 06 summary
{ const s=wb.worksheets.getItem('06_월별요약'); title(s,'2025년 월별 수요확정 요약','I'); subtitle(s,'월별 더미데이터가 수요확정 화면의 요약 KPI와 일치하는지 확인하기 위한 요약표입니다.','I'); const rows=[['월도','OL 기기수량','OL 옵션·부품·소모품','SFDC 추가수요','Bulk-deal 원수요','Bulk 반영수요','확정수요','실적 기기수량','확정상태']]; for(let m=1;m<=12;m++){ const ol=items.slice(0,4).reduce((sum,it)=>sum+Math.round(it.base*(1+((m%4)-1.5)*0.06)),0); const add=18+(m%4)*6; const bulk=40+(m%3)*20; const rate=m%3===0?1:0.5; const actual=Math.round(ol*(0.94+((m%3)*0.03))); rows.push([monthLabel(m),ol,items.slice(4).reduce((sum,it)=>sum+Math.round(it.base*(1+((m%4)-1.5)*0.06)),0),add,bulk,bulk*rate,null,actual,m<=3?'확정':m<=8?'조건부':'회의 전']); } s.getRange(`A4:I${rows.length+3}`).values=rows; header(s,'A4:I4'); body(s,`A5:I${rows.length+3}`); for(let r=5;r<rows.length+4;r++) s.getRange(`G${r}`).formulas=[[`=B${r}+D${r}+F${r}`]]; s.getRange(`B5:H${rows.length+3}`).setNumberFormat('#,##0'); widths(s,{A:14,B:16,C:22,D:16,E:18,F:16,G:16,H:18,I:14}); s.showGridLines=false; s.freezePanes.freezeRows(4); }

const xlsx=await SpreadsheetFile.exportXlsx(wb);
const outputPath=`${outputDir}/2025_수요확정_더미데이터.xlsx`;
await xlsx.save(outputPath);
const check=await wb.inspect({kind:'table',range:"06_월별요약!A4:I16",include:'values,formulas',tableMaxRows:20,tableMaxCols:12});
console.log(check.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{useRegex:true,maxResults:100},summary:'dummy data formula error scan'});
console.log(errors.ndjson);
for(const [sheetName,range] of [['00_사용안내','A1:F10'],['01_OL_2025','A1:L15'],['05_수급회의_확정수요','A1:J16'],['06_월별요약','A1:I16']]){ const blob=await wb.render({sheetName,range,scale:1,format:'png'}); await fs.writeFile(`${outputDir}/dummy_preview_${sheetName}.png`,new Uint8Array(await blob.arrayBuffer())); }
console.log(`saved ${outputPath}`);
