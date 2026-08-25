import fs from 'node:fs/promises';

const OUTPUT=new URL('../external-menus.json',import.meta.url);
const SOURCES={
  mcdonalds:'https://www.mcdonalds.co.jp/quality/allergy_Nutrition/nutrient/',
  mos:'https://www.mos.jp/menu/pdf/nutrition.pdf',
  matsuya:'https://bento.matsuyafoods.co.jp/matsuya/safety/allergen.html',
  sukiya:'https://images.zensho.co.jp/materials/sukiya/allergen/nutrition.pdf',
  yoshinoya:'https://www.yoshinoya.com/pdf/allergy/',
  famima:'https://www.family.co.jp/goods/safety.html',
  seven:'https://www.sej.co.jp/products/a/',
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

async function crawlYoshinoya(){
  const response=await fetch(SOURCES.yoshinoya,{headers:{'user-agent':'diet-app-menu-updater/1.0 (+https://github.com/fmokutagawa-design/diet-app)'}});
  if(!response.ok)throw new Error(`${SOURCES.yoshinoya}: HTTP ${response.status}`);
  let bytes=new Uint8Array(await response.arrayBuffer());
  const magic=new TextEncoder().encode('%PDF-');
  const start=bytes.findIndex((_,i)=>magic.every((v,j)=>bytes[i+j]===v));
  if(start<0)throw new Error('Yoshinoya response is not a PDF');
  bytes=bytes.slice(start);
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=await pdfjs.getDocument({data:bytes}).promise,rows=[];
  const order=size=>/小盛|ミニ/.test(size)?0:/並盛|一枚|1個/.test(size)?1:/中盛|二枚|2個/.test(size)?2:/アタマ/.test(size)?3:/大盛|三枚|3個/.test(size)?4:/特盛|四枚|4個/.test(size)?5:/超特盛|メガ|五枚|5個/.test(size)?6:9;
  for(let pageNo=4;pageNo<=Math.min(9,pdf.numPages);pageNo++){
    const page=await pdf.getPage(pageNo),content=await page.getTextContent();
    const tokens=content.items.filter(x=>x.str.trim()).map(x=>({s:x.str.trim(),x:x.transform[4],y:x.transform[5]}));
    const names=tokens.filter(x=>x.x>=170&&x.x<500&&x.y<2900&&!/メニュー|カテゴリー|カロリー|栄養|更新|ページ|アレル|について|なります|ください|お客様|一覧|共通|店舗|含まず|調味料/.test(x.s)&&!x.s.startsWith('※')&&/[ぁ-んァ-ヶ一-龠]/.test(x.s));
    const raw=[];
    for(const kcalToken of tokens.filter(x=>x.x>=610&&x.x<700&&/^\d[\d,.]*$/.test(x.s))){
      const at=(lo,hi)=>tokens.find(x=>Math.abs(x.y-kcalToken.y)<4&&x.x>=lo&&x.x<hi)?.s;
      const kcal=Number(kcalToken.s.replaceAll(',','')),protein=Number(at(700,790)),fat=Number(at(790,890));
      if(![kcal,protein,fat].every(Number.isFinite)||kcal<50)continue;
      const size=tokens.find(x=>Math.abs(x.y-kcalToken.y)<6&&x.x>=500&&x.x<610&&/[ぁ-んァ-ヶ一-龠]/.test(x.s))?.s||'';
      raw.push({y:kcalToken.y,size,kcal,protein,fat});
    }
    raw.sort((a,b)=>b.y-a.y);
    const groups=[];let current=[];
    for(const row of raw){
      if(!row.size){if(current.length){groups.push(current);current=[];}groups.push([row]);continue;}
      if(current.length&&order(row.size)<=order(current[current.length-1].size)){groups.push(current);current=[];}
      current.push(row);
    }
    if(current.length)groups.push(current);
    for(const group of groups){
      const center=group.reduce((a,x)=>a+x.y,0)/group.length;
      const name=names.slice().sort((a,b)=>Math.abs(a.y-center)-Math.abs(b.y-center))[0]?.s;
      if(!name)continue;
      if((name.length<3&&!/^(牛丼|豚丼|牛皿|豚皿|冷汁)$/.test(name))||/^[（(]/.test(name))continue;
      for(let rowNo=0;rowNo<group.length;rowNo++){
        const row=group[rowNo];
        if(row.kcal<120||row.kcal>850||row.protein<8||/ご飯|ライス|ドリンク|コーラ|コーヒー|ビール|ハイボール|ソース|たれ|ドレッシング|セット$/.test(name))continue;
        rows.push({id:`yoshinoya-${pageNo}-${Math.round(row.y)}`,n:`吉野家 ${name}${row.size?`（${row.size}）`:''}`,s:['yoshinoya'],p:row.protein,kcal:row.kcal,f:row.fat,yen:null,days:dayTypes(row.kcal),kind:'gai',official:true,category:'吉野家',sourceUrl:SOURCES.yoshinoya});
      }
    }
  }
  const unique=[...new Map(rows.map(x=>[x.n,x])).values()];
  if(unique.length<30)throw new Error(`Yoshinoya parse yielded only ${unique.length} items`);
  const ranked=unique.sort((a,b)=>(b.p/b.kcal)-(a.p/a.kcal));
  const selected=ranked.slice(0,70).concat(ranked.filter(x=>/牛丼|豚丼|牛皿|豚皿|サラダ/.test(x.n)));
  return [...new Map(selected.map(x=>[x.n,x])).values()];
}

async function crawlFamima(){
  const categoryIds=['010','020','030','040','060','070','080','090','100'];
  const pages=await Promise.all(categoryIds.map(id=>fetchText(`https://www.family.co.jp/goods/safety/goods${id}.html`)));
  const rows=[];
  for(let pageNo=0;pageNo<pages.length;pageNo++){
    const sections=pages[pageNo].split('<div class="item_basic_info">').slice(1);
    for(let rowNo=0;rowNo<sections.length;rowNo++){
      const section=sections[rowNo];
      const link=section.match(/<p class="name">[\s\S]*?<a href="([^"]+)">([\s\S]*?)<\/a>/);
      const values=[...section.matchAll(/<td class="con_nut">\s*([\d,.]+)\s*<\/td>/g)].map(x=>Number(x[1].replaceAll(',','')));
      const inKanto=/ly-mod-tag-area-on"><em>関東<\/em>/.test(section);
      if(!link||values.length<3||!inKanto)continue;
      const [kcal,protein,fat]=values,name=clean(link[2]);
      if(![kcal,protein,fat].every(Number.isFinite)||kcal<120||kcal>850||protein<8)continue;
      if(/ドリンク|コーヒー|ラテ|お茶|ジュース|酒|ビール/.test(name))continue;
      rows.push({id:`famima-${categoryIds[pageNo]}-${rowNo}`,n:`ファミマ ${name}`,s:['famima'],p:protein,kcal,f:fat,yen:null,days:dayTypes(kcal),kind:'gai',official:true,category:`ファミマ goods${categoryIds[pageNo]}`,regions:['関東'],sourceUrl:new URL(link[1],SOURCES.famima).href});
    }
  }
  const unique=[...new Map(rows.map(x=>[x.n,x])).values()];
  if(unique.length<30)throw new Error(`FamilyMart parse yielded only ${unique.length} items`);
  return unique.sort((a,b)=>(b.p/b.kcal)-(a.p/a.kcal)).slice(0,80);
}

async function crawlSeven(){
  const categories=['onigiri','sushi','bento','sandwich','bread','men','pasta','gratin','dailydish','salad','hotsnack','oden','chukaman','frozen_foods'];
  const pages=await Promise.all(categories.map(category=>fetchText(new URL(`${category}/`,SOURCES.seven).href)));
  const candidates=[];
  for(let pageNo=0;pageNo<pages.length;pageNo++){
    const sections=pages[pageNo].split('<div class="item_ttl">').slice(1);
    for(const section of sections){
      const link=section.match(/<a href="([^"#]+)">([\s\S]*?)<\/a>/);
      const region=clean(section.match(/<div class="item_region">[\s\S]*?<p>[\s\S]*?<span>販売地域：<\/span>([\s\S]*?)<\/p>/)?.[1]||'');
      if(!link||!/(関東|東京都|神奈川県|埼玉県|千葉県|茨城県|栃木県|群馬県)/.test(region))continue;
      const sourceUrl=new URL(link[1],SOURCES.seven).href;
      candidates.push({sourceUrl,name:clean(link[2]),region,category:categories[pageNo]});
    }
  }
  const unique=[...new Map(candidates.map(x=>[x.sourceUrl,x])).values()],rows=[];
  for(let offset=0;offset<unique.length;offset+=10){
    const batch=unique.slice(offset,offset+10);
    const details=await Promise.all(batch.map(x=>fetchText(x.sourceUrl)));
    for(let i=0;i<batch.length;i++){
      const candidate=batch[i],html=details[i];
      const nutrition=clean(html.match(/<th[^>]*>栄養成分<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/)?.[1]||'');
      const values=nutrition.match(/熱量：([\d,.]+)kcal、たんぱく質：([\d,.]+)g、脂質：([\d,.]+)g/);
      if(!values)continue;
      const kcal=num(values[1]),protein=num(values[2]),fat=num(values[3]);
      if(kcal==null||protein==null||fat==null||kcal<120||kcal>850||protein<8)continue;
      if(/ドリンク|コーヒー|ラテ|お茶|ジュース|酒|ビール/.test(candidate.name))continue;
      const priceText=clean(html.match(/<div class="item_price">[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1]||'');
      const taxIncluded=priceText.match(/税込\s*([\d,.]+)円/)?.[1];
      const basePrice=priceText.match(/([\d,.]+)円/)?.[1];
      const itemId=candidate.sourceUrl.match(/\/item\/([^/]+)\//)?.[1]||`${offset+i}`;
      rows.push({id:`seven-${itemId}`,n:`セブン ${candidate.name}`,s:['seven'],p:protein,kcal,f:fat,yen:num(taxIncluded||basePrice||''),days:dayTypes(kcal),kind:'gai',official:true,category:`セブン ${candidate.category}`,regions:['関東'],sourceUrl:candidate.sourceUrl});
    }
  }
  if(rows.length<30)throw new Error(`Seven-Eleven parse yielded only ${rows.length} items`);
  return rows.sort((a,b)=>(b.p/b.kcal)-(a.p/a.kcal)).slice(0,80);
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
items=items.filter(x=>!x.id?.startsWith('yoshinoya-'));
try{
  const found=await crawlYoshinoya();
  items=items.concat(found);
  sources.yoshinoya={status:'ok',updatedAt:new Date().toISOString(),url:SOURCES.yoshinoya,count:found.length,label:'吉野家公式栄養成分表'};
}catch(error){
  items=items.concat(previous.items.filter(x=>x.id?.startsWith('yoshinoya-')));
  sources.yoshinoya={...(sources.yoshinoya||{}),status:'error',lastAttemptAt:new Date().toISOString(),url:SOURCES.yoshinoya,error:String(error.message||error)};
  if(!items.length)throw error;
}
items=items.filter(x=>!x.id?.startsWith('famima-'));
try{
  const found=await crawlFamima();
  items=items.concat(found);
  sources.famima={status:'ok',updatedAt:new Date().toISOString(),url:SOURCES.famima,count:found.length,label:'ファミマ公式栄養成分情報（関東）'};
}catch(error){
  items=items.concat(previous.items.filter(x=>x.id?.startsWith('famima-')));
  sources.famima={...(sources.famima||{}),status:'error',lastAttemptAt:new Date().toISOString(),url:SOURCES.famima,error:String(error.message||error)};
  if(!items.length)throw error;
}
items=items.filter(x=>!x.id?.startsWith('seven-'));
try{
  const found=await crawlSeven();
  items=items.concat(found);
  sources.seven={status:'ok',updatedAt:new Date().toISOString(),url:SOURCES.seven,count:found.length,label:'セブン公式商品情報（関東）'};
}catch(error){
  items=items.concat(previous.items.filter(x=>x.id?.startsWith('seven-')));
  sources.seven={...(sources.seven||{}),status:'error',lastAttemptAt:new Date().toISOString(),url:SOURCES.seven,error:String(error.message||error)};
  if(!items.length)throw error;
}
const output={schemaVersion:1,generatedAt:new Date().toISOString(),sources,items};
await fs.writeFile(OUTPUT,JSON.stringify(output,null,2)+'\n');
console.log(`external-menus.json: ${items.length} items`);
