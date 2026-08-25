import fs from 'node:fs/promises';

const OUTPUT=new URL('../external-menus.json',import.meta.url);
const SOURCES={
  mcdonalds:'https://www.mcdonalds.co.jp/quality/allergy_Nutrition/nutrient/',
};

function clean(s){return s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
function num(s){const n=Number(clean(s).replace(/,/g,''));return Number.isFinite(n)?n:null;}
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
const output={schemaVersion:1,generatedAt:new Date().toISOString(),sources,items};
await fs.writeFile(OUTPUT,JSON.stringify(output,null,2)+'\n');
console.log(`external-menus.json: ${items.length} items`);
