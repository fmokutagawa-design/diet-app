import fs from 'node:fs/promises';

const OUTPUT=new URL('../external-menus.json',import.meta.url);
const SOURCES={
  mcdonalds:'https://www.mcdonalds.co.jp/quality/allergy_Nutrition/nutrient/',
  mos:'https://www.mos.jp/menu/pdf/nutrition.pdf',
  matsuya:'https://bento.matsuyafoods.co.jp/matsuya/safety/allergen.html',
  sukiya:'https://images.zensho.co.jp/materials/sukiya/allergen/nutrition.pdf',
};

function clean(s){return s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
function num(s){const n=parseFloat(clean(s).replace(/,/g,''));return Number.isFinite(n)?n:null;}
function dayTypes(kcal){return kcal<=420?['train','rest','night']:kcal<=700?['train','rest']:['train'];}

async function fetchText(url){
  const r=await fetch(url,{headers:{'user-agent':'diet-app-menu-updater/1.0 (+https://github.com/fmokutagawa-design/diet-app)'}});
  if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function crawlMcDonalds(){
  const html=await fetchText(SOURCES.mcdonalds);
  const rows=[...html.matchAll(/<tr\s+data-kind=['"]([^'"]+)['"]>([\s\S]*?)<\/tr>/g)];
  const items=[];
  for(const [,category,row] of rows){
    const link=row.match(/<a\s+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/);
    const cells=[...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1]);
    if(!link||cells.length<4)continue;
    const name=clean(link[2]),kcal=num(cells[1]),protein=num(cells[2]),fat=num(cells[3]);
    if(!name||kcal==null||protein==null||fat==null||kcal<120||kcal>850||protein<8)continue;
    if(/ドリンク|コーヒー|紅茶|ティー|シェイク|フロート/.test(category+name))continue;
    items.push({
      id:`mcd-${link[1].split('/').filter(Boolean).pop()}`,
      n:`マクドナルド ${name}`,s:['mcdonalds'],p:protein,kcal,f:fat,yen:null,
      days:dayTypes(kcal),kind:'gai',official:true,category,
      sourceUrl:new URL(link[1],SOURCES.mcdonalds).href,
    });
  }
  if(items.length<15)throw new Error(`McDonald's parse yielded only ${items.length} items`);
  return items.sort((a,b)=>(b.p/b.kcal)-(a.p/a.kcal)).slice(0,60);
}

async function crawlMos(){
  const categories=[26,27,1,35,30,33,7,12];
  const lists=await Promise.all(categories.map(id=>fetchText(`https://www.mos.jp/data/menu/menu_category/${id}.json`).then(JSON.parse)));
  const seen=new Set(),items=[];
  for(let i=0;i<lists.length;i++)for(const menu of lists[i]){
    if(!menu?.id||seen.has(menu.id)||menu.group)continue;
    seen.add(menu.id);
    const nutrients=Object.fromEntries((menu.nutrition||[]).map(x=>[x.name,num(String(x.quantity||''))]));
    const kcal=nutrients['エネルギー']??num(String(menu.kcal||'')),protein=nutrients['たんぱく質'],fat=nutrients['脂質'];
    if(kcal==null||protein==null||fat==null||kcal<100||kcal>850||protein<8)continue;
    items.push({
      id:`mos-${menu.id}`,n:`モス ${clean(menu.name)}`,s:['mos'],p:protein,kcal,f:fat,yen:num(String(menu.price||'')),
      days:dayTypes(kcal),kind:'gai',official:true,category:`モス category ${categories[i]}`,
      sourceUrl:`https://www.mos.jp/menu/detail/nutrition/?menu_id=${encodeURIComponent(menu.id)}&c_id=${categories[i]}`,
    });
  }
  if(items.length<15)throw new Error(`MOS parse yielded only ${items.length} items`);
  return items.sort((a,b)=>(b.p/b.kcal)-(a.p/a.kcal)).slice(0,60);
}

async function crawlMatsuya(){
  const landing=await fetchText(SOURCES.matsuya);
  const pdfPath=landing.match(/href=["']([^"']+_nutritional_matsuya\.pdf)["']/)?.[1];
  if(!pdfPath)throw new Error('Current Matsuya nutrition PDF was not found');
  const pdfUrl=new URL(pdfPath,SOURCES.matsuya).href;
  const response=await fetch(pdfUrl,{headers:{'user-agent':'diet-app-menu-updater/1.0 (+https://github.com/fmokutagawa-design/diet-app)'}});
  if(!response.ok)throw new Error(`${pdfUrl}: HTTP ${response.status}`);
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await response.arrayBuffer())}).promise;
  const rows=[];
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo),content=await page.getTextContent();
    const tokens=content.items.map(x=>x.str.trim()).filter(Boolean);
    for(let i=0;i<tokens.length-5;i++){
      const values=tokens.slice(i+1,i+6).map(x=>Number(x.replaceAll(',','')));
      if(values.every(Number.isFinite)&&values[0]>=50&&values[0]<2500&&/[ぁ-んァ-ヶ一-龠]/.test(tokens[i])){
        const [kcal,protein,fat]=values;
        if(kcal>=120&&kcal<=850&&protein>=8&&!/たれ|ドレッシング|ソース|ライス単品|ビール|ハイボール/.test(tokens[i])){
          rows.push({id:`matsuya-${pageNo}-${i}`,n:`松屋 ${tokens[i]}`,s:['matsuya'],p:protein,kcal,f:fat,yen:null,days:dayTypes(kcal),kind:'gai',official:true,category:'松屋',sourceUrl:pdfUrl});
        }
        i+=5;
      }
    }
  }
  const unique=[...new Map(rows.map(x=>[x.n,x])).values()];
  if(unique.length<20)throw new Error(`Matsuya parse yielded only ${unique.length} items`);
  return {items:unique.sort((a,b)=>(b.p/b.kcal)-(a.p/a.kcal)).slice(0,70),pdfUrl};
}

async function crawlSukiya(){
  const response=await fetch(SOURCES.sukiya,{headers:{'user-agent':'diet-app-menu-updater/1.0 (+https://github.com/fmokutagawa-design/diet-app)'}});
  if(!response.ok)throw new Error(`${SOURCES.sukiya}: HTTP ${response.status}`);
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await response.arrayBuffer())}).promise;
  const rows=[];
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo),content=await page.getTextContent();
    const tokens=content.items.filter(x=>x.str.trim()).map(x=>({s:x.str.trim(),x:x.transform[4],y:x.transform[5]}));
    const names=tokens.filter(x=>x.x>=85&&x.x<190&&x.y<680&&!/メニュー|カテゴリー|カロリー|栄養|更新日/.test(x.s)&&/[ぁ-んァ-ヶ一-龠]/.test(x.s));
    const sizes=tokens.filter(x=>x.x>=190&&x.x<280&&x.y<680&&/[ぁ-んァ-ヶ一-龠]/.test(x.s));
    for(let rowNo=0;rowNo<sizes.length;rowNo++){
      const size=sizes[rowNo],at=(lo,hi)=>tokens.find(x=>Math.abs(x.y-size.y)<1.5&&x.x>=lo&&x.x<hi)?.s;
      const kcal=Number((at(280,345)||'').replaceAll(',','')),protein=Number(at(345,390)),fat=Number(at(390,440));
      const name=names.slice().sort((a,b)=>Math.abs(a.y-size.y)-Math.abs(b.y-size.y))[0]?.s;
      if(!name||![kcal,protein,fat].every(Number.isFinite)||kcal<120||kcal>850||protein<8)continue;
      if(/ごはん$|ドリンク|コーヒー|ラテ|レモネード|シェイク|ビール|ハイボール|ソース|ドレッシング/.test(name))continue;
      rows.push({id:`sukiya-${pageNo}-${rowNo}`,n:`すき家 ${name}（${size.s}）`,s:['sukiya'],p:protein,kcal,f:fat,yen:null,days:dayTypes(kcal),kind:'gai',official:true,category:'すき家',sourceUrl:SOURCES.sukiya});
    }
  }
  const unique=[...new Map(rows.map(x=>[x.n,x])).values()];
  if(unique.length<30)throw new Error(`Sukiya parse yielded only ${unique.length} items`);
  return unique.sort((a,b)=>(b.p/b.kcal)-(a.p/a.kcal)).slice(0,70);
}

const previous=await fs.readFile(OUTPUT,'utf8').then(JSON.parse).catch(()=>({sources:{},items:[]}));
const sources={...previous.sources};
let items=previous.items.filter(x=>!x.id?.startsWith('mcd-'));
try{
  const found=await crawlMcDonalds();
  items=items.concat(found);
  sources.mcdonalds={status:'ok',updatedAt:new Date().toISOString(),url:SOURCES.mcdonalds,count:found.length,label:'マクドナルド公式栄養成分表'};
}catch(error){
  items=items.concat(previous.items.filter(x=>x.id?.startsWith('mcd-')));
  sources.mcdonalds={...(sources.mcdonalds||{}),status:'error',lastAttemptAt:new Date().toISOString(),url:SOURCES.mcdonalds,error:String(error.message||error)};
  if(!items.length)throw error;
}
items=items.filter(x=>!x.id?.startsWith('mos-'));
try{
  const found=await crawlMos();
  items=items.concat(found);
  sources.mos={status:'ok',updatedAt:new Date().toISOString(),url:SOURCES.mos,count:found.length,label:'モス公式メニュー・栄養成分情報'};
}catch(error){
  items=items.concat(previous.items.filter(x=>x.id?.startsWith('mos-')));
  sources.mos={...(sources.mos||{}),status:'error',lastAttemptAt:new Date().toISOString(),url:SOURCES.mos,error:String(error.message||error)};
  if(!items.length)throw error;
}
items=items.filter(x=>!x.id?.startsWith('matsuya-'));
try{
  const found=await crawlMatsuya();
  items=items.concat(found.items);
  sources.matsuya={status:'ok',updatedAt:new Date().toISOString(),url:found.pdfUrl,count:found.items.length,label:'松屋公式栄養成分表'};
}catch(error){
  items=items.concat(previous.items.filter(x=>x.id?.startsWith('matsuya-')));
  sources.matsuya={...(sources.matsuya||{}),status:'error',lastAttemptAt:new Date().toISOString(),url:SOURCES.matsuya,error:String(error.message||error)};
  if(!items.length)throw error;
}
items=items.filter(x=>!x.id?.startsWith('sukiya-'));
try{
  const found=await crawlSukiya();
  items=items.concat(found);
  sources.sukiya={status:'ok',updatedAt:new Date().toISOString(),url:SOURCES.sukiya,count:found.length,label:'すき家公式栄養成分表'};
}catch(error){
  items=items.concat(previous.items.filter(x=>x.id?.startsWith('sukiya-')));
  sources.sukiya={...(sources.sukiya||{}),status:'error',lastAttemptAt:new Date().toISOString(),url:SOURCES.sukiya,error:String(error.message||error)};
  if(!items.length)throw error;
}
const output={schemaVersion:1,generatedAt:new Date().toISOString(),sources,items};
await fs.writeFile(OUTPUT,JSON.stringify(output,null,2)+'\n');
console.log(`external-menus.json: ${items.length} items`);
