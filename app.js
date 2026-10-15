
const DB='finance-pwa-v1';
let db,txs=[],holds=[];
const $=id=>document.getElementById(id);
const today=()=>new Date().toISOString().slice(0,10);

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const money=(n,c='INR')=>{
  try {
    return new Intl.NumberFormat('en-IN',{
      style:'currency',currency:c,maximumFractionDigits:2
    }).format(Number(n)||0);
  } catch {
    return c+' '+Number(n||0).toLocaleString();
  }
};

function toast(s){
  const el=$('toast');
  if(!el)return;
  el.textContent=s;
  el.hidden=false;
  setTimeout(()=>el.hidden=true,3000);
}

function openDB(){
  return new Promise((ok,no)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>{
      const d=r.result;
      if(!d.objectStoreNames.contains('txs'))
        d.createObjectStore('txs',{keyPath:'id'});
      if(!d.objectStoreNames.contains('holds'))
        d.createObjectStore('holds',{keyPath:'id'});
    };
    r.onsuccess=()=>ok(r.result);
    r.onerror=()=>no(r.error);
  });
}

function all(s){
  return new Promise((ok,no)=>{
    const r=db.transaction(s,'readonly').objectStore(s).getAll();
    r.onsuccess=()=>ok(r.result||[]);
    r.onerror=()=>no(r.error);
  });
}

function put(s,o){
  return new Promise((ok,no)=>{
    const t=db.transaction(s,'readwrite');
    t.objectStore(s).put(o);
    t.oncomplete=()=>ok();
    t.onerror=()=>no(t.error);
  });
}

function clear(s){
  return new Promise((ok,no)=>{
    const t=db.transaction(s,'readwrite');
    t.objectStore(s).clear();
    t.oncomplete=()=>ok();
    t.onerror=()=>no(t.error);
  });
}

function fp(t){
  return t.fingerprint||JSON.stringify([
    t.date,t.account,t.category,t.note,t.type,
    Number(t.amount).toFixed(2),t.currency||'INR'
  ]);
}

function norm(t,i=0){
  let ty=String(t.type||'').toLowerCase();
  if(!['expense','income','transfer'].includes(ty)){
    ty=String(t['Income/Expense']||'Exp.')
      .toLowerCase().startsWith('inc')?'income':'expense';
  }

  let d=String(t.date||t.Period||'').slice(0,10);
  let n=Number(t.amount??t.Amount??t.INR??0);
  if(!Number.isFinite(n))n=0;

  const o={
    id:String(t.id||`import-${Date.now()}-${i}-${Math.random().toString(16).slice(2,7)}`),
    date:d,
    type:ty,
    amount:Math.abs(n),
    currency:String(t.currency||t.Currency||'INR').toUpperCase(),
    category:String(t.category||t.Category||'Uncategorised'),
    note:String(t.note||t.Note||t.description||t.Description||''),
    account:String(t.account||t.Accounts||''),
    source:String(t.source||'Imported')
  };
  o.fingerprint=fp(o);
  return o;
}

async function merge(list){
  const old=await all('txs');
  const fps=new Set(old.map(fp));
  let added=0,skipped=0;

  for(let i=0;i<list.length;i++){
    const t=norm(list[i],i);
    const f=fp(t);

    if(fps.has(f)||!t.date||t.amount<0){
      skipped++;
      continue;
    }

    if(old.some(x=>x.id===t.id))t.id+='-'+Date.now();
    t.fingerprint=f;
    await put('txs',t);
    fps.add(f);
    added++;
  }

  await refresh();
  return {added,skipped};
}

async function refresh(){
  txs=await all('txs');
  holds=await all('holds');
  render();
  if($('status'))
    $('status').textContent=`Local · ${txs.length.toLocaleString()} records`;
}

function total(type,c='INR',list=txs){
  return list.filter(t=>t.type===type&&(t.currency||'INR')===c)
    .reduce((s,t)=>s+Number(t.amount||0),0);
}

function render(){
  const exp=total('expense');
  const inc=total('income');
  const month=today().slice(0,7);

  const me=txs.filter(t=>
    t.type==='expense'&&t.currency==='INR'&&String(t.date).startsWith(month)
  ).reduce((s,t)=>s+Number(t.amount||0),0);

  if($('m-exp'))$('m-exp').textContent=money(exp);
  if($('m-count'))$('m-count').textContent=
    `${txs.filter(t=>t.type==='expense'&&t.currency==='INR').length} INR expense records`;
  if($('m-month'))$('m-month').textContent=money(me);
  if($('m-monthnote'))$('m-monthnote').textContent=
    `${txs.filter(t=>t.type==='expense'&&t.currency==='INR'&&String(t.date).startsWith(month)).length} recorded transactions`;
  if($('m-inc'))$('m-inc').textContent=money(inc);
  if($('m-net')){
    $('m-net').textContent=money(inc-exp);
    $('m-net').style.color=inc-exp<0?'var(--red)':'var(--green)';
  }

  const cat={};
  txs.filter(t=>t.type==='expense'&&t.currency==='INR').forEach(t=>{
    const k=t.category||'Uncategorised';
    cat[k]=(cat[k]||0)+Number(t.amount||0);
  });

  const cs=Object.entries(cat).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max=cs[0]?.[1]||1;

  if($('categories')){
    $('categories').innerHTML=cs.length?cs.map(([k,v])=>
      `<div class="barrow"><span>${esc(k).slice(0,22)}</span>
      <div class="track"><div class="fill" style="width:${Math.max(2,v/max*100)}%"></div></div>
      <b>${money(v)}</b></div>`
    ).join(''):'<div class="empty"><b>No INR expenses yet</b>Import your Money Manager export to get started.</div>';
  }

  const recent=[...txs].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,6);

  if($('recent')){
    $('recent').innerHTML=recent.length?recent.map(t=>
      `<div style="display:flex;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)">
      <div><b>${esc(t.category)}</b><div class="muted small">${esc(t.date)} · ${esc(t.account)}</div></div>
      <div style="text-align:right;white-space:nowrap">
      <b style="color:${t.type==='income'?'var(--green)':t.type==='expense'?'var(--red)':'var(--muted)'}">${t.type==='expense'?'−':t.type==='income'?'+':''}${money(t.amount,t.currency)}</b>
      <div class="muted small">${esc(t.type)}</div></div></div>`
    ).join(''):'<div class="empty"><b>Your activity will appear here</b>Import data or add a transaction.</div>';
  }

  renderTable();

  const inr=holds.filter(h=>h.currency==='INR');
  if($('hcost'))$('hcost').textContent=money(inr.reduce((s,h)=>s+h.cost,0));
  if($('hvalue'))$('hvalue').textContent=money(inr.reduce((s,h)=>s+h.value,0));
  if($('hgain'))$('hgain').textContent=money(inr.reduce((s,h)=>s+h.value-h.cost,0));
  if($('hcount'))$('hcount').textContent=holds.length;

  if($('hrows')){
    $('hrows').innerHTML=holds.length?holds.map(h=>
      `<tr><td><b>${esc(h.name)}</b><div class="muted small">${h.quantity?esc(h.quantity)+' units':''}</div></td>
      <td>${esc(h.account||'—')}</td><td>${esc(h.currency)}</td>
      <td class="right">${money(h.cost,h.currency)}</td>
      <td class="right">${money(h.value,h.currency)}</td>
      <td><button class="btn" data-delhold="${esc(h.id)}">Delete</button></td></tr>`
    ).join(''):'<tr><td colspan="6">No holdings added yet.</td></tr>';
  }
}

function renderTable(){
  if(!$('search')||!$('typefilter')||!$('yearfilter')||!$('txrows'))return;

  const q=$('search').value.toLowerCase();
  const typ=$('typefilter').value;
  const year=$('yearfilter').value;
  const years=[...new Set(txs.map(t=>String(t.date).slice(0,4))
    .filter(y=>/^\d{4}$/.test(y)))].sort().reverse();

  const sel=$('yearfilter');
  const old=sel.value;
  sel.innerHTML='<option value="all">All years</option>'+
    years.map(y=>`<option>${y}</option>`).join('');
  sel.value=years.includes(old)?old:'all';

  const rows=txs.filter(t=>
    (typ==='all'||t.type===typ)&&
    (sel.value==='all'||t.date.startsWith(sel.value))&&
    [t.category,t.note,t.account,t.date].join(' ').toLowerCase().includes(q)
  ).sort((a,b)=>String(b.date).localeCompare(String(a.date)));

  if($('txcount'))$('txcount').textContent=
    `${rows.length} matching · ${txs.length} total records`;

  $('txrows').innerHTML=rows.length?rows.slice(0,500).map(t=>
    `<tr><td>${esc(t.date)}</td><td><b>${esc(t.category)}</b><div class="muted small">${esc(t.note)}</div></td>
    <td>${esc(t.account||'—')}</td><td><span class="tag ${esc(t.type)}">${esc(t.type)}</span></td>
    <td class="right">${money(t.amount,t.currency)}</td></tr>`
  ).join(''):'<tr><td colspan="5">No matching transactions.</td></tr>';

  if($('txfoot'))$('txfoot').textContent=
    rows.length>500?'Showing first 500 records. Narrow using search/year filters.':'';
}

function view(v){
  document.querySelectorAll('.view').forEach(e=>
    e.classList.toggle('active',e.id==='v-'+v)
  );
  document.querySelectorAll('[data-view]').forEach(e=>
    e.classList.toggle('active',e.dataset.view===v)
  );
  if(v==='transactions')renderTable();
  window.scrollTo({top:0,behavior:'smooth'});
}

document.querySelectorAll('[data-view]').forEach(e=>{
  e.onclick=()=>view(e.dataset.view);
});
document.querySelectorAll('[data-goto]').forEach(e=>{
  e.onclick=()=>view(e.dataset.goto);
});

function dl(name,data,type='application/json'){
  const u=URL.createObjectURL(new Blob([data],{type}));
  const a=document.createElement('a');
  a.href=u;
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(u),1000);
}

function backup(){
  dl(`personal-finance-backup-${today()}.json`,
    JSON.stringify({
      app:'personal-finance-local',
      schema_version:1,
      exported_at:new Date().toISOString(),
      transactions:txs,
      holdings:holds
    },null,2));
  toast('Backup exported. Store it privately.');
}

if($('quickbackup'))$('quickbackup').onclick=backup;
if($('exportjson'))$('exportjson').onclick=backup;

if($('csv')){
  $('csv').onclick=()=>{
    const hs=['date','type','amount','currency','category','note','account','source'];
    const csv=[hs.join(','),...txs.map(t=>
      hs.map(k=>'"'+String(t[k]??'').replace(/"/g,'""')+'"').join(',')
    )].join('\r\n');
    dl(`transactions-${today()}.csv`,csv,'text/csv');
    toast('CSV exported');
  };
}

function openModal(id){if($(id))$(id).classList.add('open');}
function closeModal(id){if($(id))$(id).classList.remove('open');}
function makeId(p){
  return p+'-'+Date.now()+'-'+Math.random().toString(16).slice(2,7);
}

if($('add'))$('add').onclick=$('add2').onclick=()=>{
  if($('fdate'))$('fdate').value=today();
  openModal('txmodal');
};
if($('cancel'))$('cancel').onclick=()=>closeModal('txmodal');

if($('txmodal')){
  $('txmodal').onclick=e=>{
    if(e.target.id==='txmodal')closeModal('txmodal');
  };
}

if($('txform')){
  $('txform').onsubmit=async e=>{
    e.preventDefault();
    const t=norm({
      id:makeId('manual'),
      date:$('fdate').value,
      type:$('ftype').value,
      amount:$('famount').value,
      currency:$('fcurrency').value,
      category:$('fcategory').value||'Uncategorised',
      account:$('faccount').value,
      note:$('fnote').value,
      description:$('fdesc').value,
      source:'Manual entry'
    });
    t.fingerprint=fp(t);
    await put('txs',t);
    await refresh();
    closeModal('txmodal');
    e.target.reset();
    toast('Saved locally');
  };
}

['search','typefilter','yearfilter'].forEach(k=>{
  if($(k))$(k).addEventListener(k==='search'?'input':'change',renderTable);
});

if($('importjson')){
  $('importjson').onclick=async()=>{
    const f=$('jsonfile')?.files?.[0];
    if(!f){
      if($('importresult'))$('importresult').innerHTML=
        '<div class="notice danger">Choose a JSON file first.</div>';
      return;
    }
    try{
      const d=JSON.parse(await f.text());
      const list=Array.isArray(d)?d:d.transactions;
      if(!Array.isArray(list))throw Error('No transactions array found.');
      const r=await merge(list);

      if(Array.isArray(d.holdings)){
        const old=await all('holds');
        const ids=new Set(old.map(h=>h.id));
        for(const h of d.holdings){
          if(!ids.has(h.id))await put('holds',h);
        }
      }

      await refresh();
      if($('importresult'))$('importresult').innerHTML=
        `<div class="notice success">Added ${r.added}; skipped ${r.skipped} matching/invalid records.</div>`;
    }catch(err){
      if($('importresult'))$('importresult').innerHTML=
        `<div class="notice danger">${esc(err.message)}</div>`;
    }
  };
}

if($('importinitial')){
  $('importinitial').onclick=()=>{
    if($('initialresult'))$('initialresult').innerHTML=
      '<div class="notice">For privacy, your transaction file is not hosted with this app. Select your private JSON backup using the file picker, then tap Import JSON.</div>';
    if($('jsonfile'))$('jsonfile').scrollIntoView({behavior:'smooth',block:'center'});
  };
}

if($('addholding'))$('addholding').onclick=()=>openModal('hmodal');
if($('hcancel'))$('hcancel').onclick=()=>closeModal('hmodal');

if($('hmodal')){
  $('hmodal').onclick=e=>{
    if(e.target.id==='hmodal')closeModal('hmodal');
  };
}

if($('hform')){
  $('hform').onsubmit=async e=>{
    e.preventDefault();
    await put('holds',{
      id:makeId('hold'),
      name:$('hn').value,
      account:$('ha').value,
      currency:$('hc').value,
      quantity:Number($('hq').value)||0,
      cost:Number($('hco').value)||0,
      value:Number($('hv').value)||0
    });
    await refresh();
    closeModal('hmodal');
    e.target.reset();
    toast('Holding saved locally');
  };
}

if($('hrows')){
  $('hrows').onclick=async e=>{
    const b=e.target.closest('[data-delhold]');
    if(!b)return;
    const t=db.transaction('holds','readwrite');
    t.objectStore('holds').delete(b.dataset.delhold);
    t.oncomplete=()=>{
      refresh();
      toast('Holding deleted');
    };
  };
}

if($('reset'))$('reset').onclick=()=>openModal('resetmodal');
if($('resetcancel'))$('resetcancel').onclick=()=>closeModal('resetmodal');

if($('resetconfirm')){
  $('resetconfirm').onclick=async()=>{
    await clear('txs');
    await clear('holds');
    await refresh();
    closeModal('resetmodal');
    toast('Local data cleared');
  };
}

if($('today')){
  $('today').textContent=new Date().toLocaleDateString('en-IN',{
    weekday:'long',day:'numeric',month:'long',year:'numeric'
  }).toUpperCase();
}

(async()=>{
  try{
    db=await openDB();
    await refresh();
    if('serviceWorker'in navigator&&location.protocol!=='file:'){
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }catch(e){
    if($('status'))$('status').textContent='Storage unavailable';
    toast(e.message);
  }
})();
