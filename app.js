'use strict';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STAGES=['KESİM','PRES','KORDON','BÜKÜM','DOĞRULTMA','GÖVDE KAYNAK','MONTAJ','ÇEVRE KAYNAK','FİTTİNGS KAYNAK','KULAK KULP KAYNAK','TANK TEMİZLİK','HİDROSTATİK TEST','BOYA','PAKETLEME','SEVKİYAT'];
const LITRES=[5,9,26,45,83,120,149,180,267,1000];
const BOMBE_MODELS=['168x4mm','168x10mm','406x5mm','355x5mm','323x4mm','219x5mm','850x5mm','600x4mm','323x5.4mm','323x3mm','219x6mm','140x4mm','450x4mm','273x6mm','168x5mm','273x5mm','406x6mm','450x5mm','545x5mm','323x5mm','850x4mm','219x4mm'];
const BOMBE_STAGES=['KESİM','PRES','KORDON ÇEKME'];
const VARIANTS=[['CIFT_GC_CIKIS_ETIKETLI','Çift G.Ç. çıkış etiketli'],['TEK_GC_CIKIS_ETIKETLI','Tek G.Ç. çıkış etiketli'],['TEK_GC_CIKIS_ETIKETSIZ','Tek G.Ç. çıkış etiketsiz']];
const isBombe=b=>b?.product_type==='BOMBE';
const isTank=b=>b?.product_type==='TANK';
const stagesFor=b=>isBombe(b)?BOMBE_STAGES:STAGES;
const detailFor=b=>isBombe(b)?`BOMBE / ${b.bombe_model||'Model belirtilmedi'}`:`${isTank(b)?'TANK':'TÜP'} / ${b.litre} LT${b.diameter_mm?' / '+b.diameter_mm+' mm':''}${b.litre_variant?' / '+(VARIANTS.find(v=>v[0]===b.litre_variant)?.[1]||b.litre_variant):''} / ${bar(b)} BAR`;

let sb=null,session=null,profile=null,page='dashboard';
let cbsPendingTimer=null,cbsPendingBusy=false;
let cbsMaintenanceActive=false,cbsMaintenanceTimer=null,cbsMaintenanceBusy=false;
let cbsPresenceTimer=null,cbsPresenceBusy=false,cbsOnlineIds=new Set();
const cbsRecoveryOnArrival = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery' || new URLSearchParams(location.search).get('type') === 'recovery';
const cbsInviteOnArrival = new URLSearchParams(location.hash.slice(1)).get('type') === 'invite' || new URLSearchParams(location.search).get('type') === 'invite';
let state={orders:[],batches:[],serials:[],profiles:[],audit:[],processes:[],history:[],stockItems:[],stockMovements:[],quality:[]};
const writable=()=>['admin','editor'].includes(profile?.role),admin=()=>profile?.role==='admin';
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),5500)}
function err(e){toast(e?.message||String(e))}
function check({error,data}){if(error)throw error;return data}
function initClient(){const cfg=window.CBS_CONFIG||{};const url=cfg.supabaseUrl||localStorage.getItem('cbs_url');const key=cfg.supabaseAnonKey||localStorage.getItem('cbs_key');if(!url||!key){$('#setup').classList.remove('hidden');return false}if(!window.supabase?.createClient){$('#setup').classList.remove('hidden');toast('Supabase kütüphanesi yüklenemedi; internet bağlantısını kontrol edin.');return false}sb=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true}});return true}
function cbsStopPending(){if(cbsPendingTimer){clearInterval(cbsPendingTimer);cbsPendingTimer=null;}}
function cbsHideAuthScreens(){['login','register','passwordHelp','setPassword','pendingApproval'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));}
function cbsShowPending(s){
 session=s;profile=null;cbsStopPresence();cbsStopMaintenancePolling();cbsHideAuthScreens();
 $('#app').classList.add('hidden');$('#pendingApproval').classList.remove('hidden');
 cbsStopPending();cbsPendingTimer=setInterval(cbsCheckPending,4000);cbsCheckPending();
}
async function cbsCheckPending(){
 if(cbsPendingBusy||!session)return;cbsPendingBusy=true;
 try{
  const {data:{session:current},error:authError}=await sb.auth.getSession();
  if(authError)throw authError;
  if(!current){cbsStopPending();loginScreen();return;}
  session=current;
  const {data:p,error}=await sb.from('profiles').select('id,email,role,active').eq('id',current.user.id).maybeSingle();
  if(error)throw error;
  if(p?.active){cbsStopPending();await enter(current);return;}
  const status=$('#pendingStatus');if(status)status.textContent='Yönetici onayı bekleniyor. Bu sayfayı açık bırakabilirsiniz.';
 }catch(e){const status=$('#pendingStatus');if(status)status.textContent='Onay kontrol edilemedi, tekrar denenecek: '+(e.message||e);}
 finally{cbsPendingBusy=false;}
}
function loginScreen(){cbsStopPending();$('#pendingApproval')?.classList.add('hidden');$('#register')?.classList.add('hidden');cbsStopPresence();cbsStopMaintenancePolling();cbsMaintenanceActive=false;document.querySelector('#cbsMaintenance')?.classList.add('hidden');session=null;profile=null;$('#app').classList.add('hidden');$('#setPassword').classList.add('hidden');$('#passwordHelp').classList.add('hidden');$('#login').classList.remove('hidden')}

function showSetPassword(firstLogin=false){
  $('#login').classList.add('hidden'); $('#passwordHelp').classList.add('hidden');
  $('#app').classList.add('hidden'); $('#register').classList.add('hidden'); $('#setPassword').classList.remove('hidden');
  const h=$('#setPassword h1'); if(h) h.textContent=firstLogin?'İlk Giriş: Kendi Şifrenizi Belirleyin':'Yeni Şifrenizi Oluşturun';
}
async function boot() {
  if (!initClient()) return;
  try {
    const { data: { session: s }, error } = await sb.auth.getSession();
    if (error) throw error;
    // Normal site ziyaretinde her zaman e-posta ve sifre giris ekrani acilir.
    // Yalnizca gercek sifre kurtarma/davet baglantilarinda sifre ekrani gosterilir.
    if (await handleInvitation()) return;
    if(s){await enter(s);return;}
    loginScreen();
  } catch (e) {
    loginScreen();
    err(e);
  }
}

async function enter(s){const {data:authData,error:authError}=await sb.auth.getUser();if(authError)throw authError;if(authData?.user?.app_metadata?.cbs_must_change_password){session=s;showSetPassword(true);return;}session=s;const p=check(await sb.from('profiles').select('id,email,role,active').eq('id',s.user.id).maybeSingle());if(!p||!p.active){cbsShowPending(s);return;}cbsStopPending();cbsHideAuthScreens();profile=p;$('#login').classList.add('hidden');$('#setup').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').textContent=p.email;$('#userEmail').textContent=p.email;$('#roleLabel').textContent=({admin:'Yönetici',editor:'Yetkili Personel',viewer:'Görüntüleyici'})[p.role];$('#usersNav').hidden=!admin();const ordersNav=document.querySelector('#menu [data-page="orders"]');if(ordersNav)ordersNav.hidden=!writable();$('#auditNav').hidden=false;const perfNav=document.querySelector('#menu [data-page="performance"]');if(perfNav)perfNav.hidden=false;$('#newOrder').hidden=true;const oldExport=document.querySelector('#export');if(oldExport)oldExport.hidden=true;const processNav=document.querySelector('#menu [data-page="serials"]');if(processNav)processNav.textContent='⚙ Proses Takibi';await refresh();const savedPage=sessionStorage.getItem('cbs_reload_page');sessionStorage.removeItem('cbs_reload_page');showPage(savedPage||'dashboard');await cbsCheckMaintenance();cbsStartMaintenancePolling();cbsStartPresence()}
async function refresh(){if(!session)return;const [o,b,s,p]=await Promise.all([sb.from('orders').select('*').order('id',{ascending:false}),sb.from('batches').select('*').order('id',{ascending:false}),sb.from('serials').select('*').order('id',{ascending:false}),sb.from('process_tracking').select('*')]);state.orders=check(o);state.batches=check(b);state.serials=check(s);state.processes=check(p);if(admin()){state.profiles=check(await sb.from('profiles').select('id,email,role,active,created_at').order('created_at'))}state.history=check(await sb.from('production_history').select('*').order('created_at',{ascending:false}).limit(1000));const [si,sm]=await Promise.all([sb.from('cbs_stock_items').select('*').order('id'),sb.from('cbs_stock_movements').select('*').order('created_at',{ascending:false}).limit(100)]);if(si.error||sm.error){console.warn('Sac stok verisi yüklenemedi:',si.error||sm.error);state.stockItems=[];state.stockMovements=[];stockLoadError=(si.error||sm.error)?.message||'Stok bilgisi okunamadı.';}else{state.stockItems=si.data||[];state.stockMovements=sm.data||[];stockLoadError='';}const qr=await sb.from('cbs_quality_entries').select('*').order('entry_date',{ascending:false}).limit(2000);state.quality=qr.error?[]:(qr.data||[]);if(qr.error)console.warn('Kalite kayıtları:',qr.error);render();if(admin())cbsLoadPresence().catch(console.warn)}
const isActiveOrder=id=>!order(id)?.archived_at;
const activeBatches=()=>state.batches.filter(b=>isActiveOrder(b.order_id));
const activeSerials=()=>state.serials.filter(s=>{const b=batch(s.batch_id);return b&&isActiveOrder(b.order_id)});
function order(id){return state.orders.find(o=>o.id===id)}function batch(id){return state.batches.find(b=>b.id===id)}function serialsFor(id){return state.serials.filter(s=>s.batch_id===id)}
function bar(b){return Number(b.pressure_bar||42)}
function batchLabel(b){return `${order(b.order_id)?.code||'?'} / ${detailFor(b)}`}
function fmt(d){return d?new Date(d).toLocaleDateString('tr-TR'):'—'}
function reached(b,stage){return Number(state.processes.find(p=>p.batch_id===b.id&&p.process_name===stage)?.quantity||0)}
function quantities(b){return stagesFor(b).map(st=>reached(b,st))}
function progress(b){const n=Number(b.target)||0;return n?Math.min(100,Math.round(100*quantities(b).reduce((sum,q)=>sum+Math.min(q,n),0)/(n*stagesFor(b).length))):0}
function shipped(b){return isBombe(b)?reached(b,'KORDON ÇEKME'):reached(b,'SEVKİYAT')}
function ready(b){return isBombe(b)?0:Math.max(0,reached(b,'PAKETLEME')-reached(b,'SEVKİYAT'))}
// Kümülatif proses girişlerinden her istasyonda fiilen bekleyen adedi hesapla.
// Sonradan girilen ileri prosesler, önceki proseslerde çift sayılmaz.
function processBalance(b){
 const target=Math.max(0,Number(b.target)||0);
 const raw=quantities(b).map(x=>Math.max(0,Number(x)||0));
 const cumulative=raw.slice();
 for(let i=cumulative.length-2;i>=0;i--)cumulative[i]=Math.max(cumulative[i],cumulative[i+1]);
 const atStage=cumulative.map((n,i)=>Math.max(0,n-(cumulative[i+1]||0)));
 const notStarted=Math.max(0,target-(cumulative[0]||0));
 const overPlan=Math.max(0,(cumulative[0]||0)-target);
 return {target,cumulative,atStage,notStarted,overPlan};
}
function waiting(b,i){return processBalance(b).atStage[i]||0}
function processTable(b){
 const x=processBalance(b),stages=stagesFor(b);
 return `<div class="tablewrap"><table><thead><tr><th>Proses</th><th>Bu Aşamada Bekleyen</th><th>Bu Prosese Ulaşan (Toplam)</th></tr></thead><tbody><tr><td><b>Henüz Üretime Girmeyen</b></td><td><b>${x.notStarted}</b></td><td>—</td></tr>${stages.map((st,i)=>`<tr><td>${i+1}. ${esc(st)}</td><td><b>${x.atStage[i]}</b></td><td>${x.cumulative[i]}</td></tr>`).join('')}<tr><td><b>TOPLAM</b></td><td><b>${x.notStarted+x.atStage.reduce((a,n)=>a+n,0)}</b></td><td>Plan: ${x.target}</td></tr></tbody></table>${x.overPlan?`<p style="color:#b42318;font-weight:700">Uyarı: Proses girişi planlanan adedi ${x.overPlan} aşıyor. Kayıtları kontrol edin.</p>`:''}</div>`;
}
function options(a,selected){return a.map(x=>`<option value="${esc(x[0])}" ${String(x[0])===String(selected)?'selected':''}>${esc(x[1])}</option>`).join('')}
function ordersOptions(){return options(state.orders.filter(o=>!o.archived_at).map(o=>[o.id,o.code]))}
function batchesOptions(){return options(activeBatches().map(b=>[b.id,batchLabel(b)]))}
function cbsLate(b){if(!b.end_date||progress(b)>=70)return false;const today=new Date();today.setHours(0,0,0,0);const d=new Date(b.end_date+'T00:00:00');const days=Math.ceil((d-today)/86400000);return days<=7;}
function cbsWarning(b){return cbsLate(b)?'<span title="Tahmini bitiş tarihine 7 gün veya daha az kaldı; ilerleme %70 altında" style="color:#bb381b;font-weight:800"> ⚠️ Gecikebilir</span>':'';}
function cbsQualityTotal(id,kind){return state.quality.filter(x=>Number(x.batch_id)===Number(id)&&x.entry_type===kind).reduce((n,x)=>n+Number(x.quantity||0),0);}
function cbsReadyPanel(){return `<div class="panel"><h2>🚚 Sevke Hazır Ürünler</h2><div class="tablewrap"><table><thead><tr><th>Sipariş Kodu</th><th>Ürün</th><th>Hazır Adet</th></tr></thead><tbody>${activeBatches().filter(b=>ready(b)>0).map(b=>`<tr><td>${esc(order(b.order_id)?.code)}</td><td>${esc(detailFor(b))}</td><td><b>${ready(b)}</b></td></tr>`).join('')||'<tr><td colspan="3">Sevke hazır ürün yok.</td></tr>'}</tbody></table></div></div>`;}
function cbsQualityPanel(){return `<div class="panel"><h2>🔧 Tamir ve Kaynak Röntgen Ret Takibi</h2><p class="muted small">Tamir ve NDT retleri günlük ayrı kaydedilir; proses ilerlemesini değiştirmez.</p>${writable()?`<form id="qualityForm" class="form"><label>Sipariş / Ürün<select name="batch_id" required>${batchesOptions()}</select></label><label>Kayıt türü<select name="entry_type"><option value="REPAIR">Tamir edilen tüp</option><option value="NDT_REJECT">Kaynak röntgen reddi</option></select></label><label>İşlem tarihi<input name="entry_date" type="date" value="${localISO(new Date())}" required></label><label>Adet<input name="quantity" type="number" min="1" step="1" required></label><label>Not<input name="note" maxlength="250"></label><button type="submit" class="btn">Kaydı Ekle</button></form>`:''}<div class="tablewrap"><table><thead><tr><th>Sipariş / Ürün</th><th>Toplam Tamir</th><th>Toplam NDT Ret</th></tr></thead><tbody>${activeBatches().map(b=>`<tr><td>${esc(batchLabel(b))}</td><td>${cbsQualityTotal(b.id,'REPAIR')}</td><td>${cbsQualityTotal(b.id,'NDT_REJECT')}</td></tr>`).join('')}</tbody></table></div><h3>Son Kayıtlar</h3><div class="tablewrap"><table><thead><tr><th>Tarih</th><th>Sipariş</th><th>Tür</th><th>Adet</th><th>Not</th><th>İşlem</th></tr></thead><tbody>${state.quality.slice(0,100).map(x=>`<tr><td>${esc(x.entry_date)}</td><td>${esc(batch(x.batch_id)?batchLabel(batch(x.batch_id)):'—')}</td><td>${x.entry_type==='REPAIR'?'Tamir':'NDT Ret'}</td><td>${x.quantity}</td><td>${esc(x.note||'—')}</td><td>${admin()?`<button type="button" class="btn secondary" data-del-quality="${x.id}">Sil</button>`:'—'}</td></tr>`).join('')}</tbody></table></div></div>`;}
function summaryTable(){return `<div class="tablewrap"><table><thead><tr><th>Sipariş</th><th>Ürün / Model</th><th>Basınç</th><th>Plan</th><th>Son Proses Adedi</th><th>İlerleme</th><th>Tahmini Bitiş Tarihi</th></tr></thead><tbody>${activeBatches().map(b=>{const pct=progress(b);return `<tr><td><b>${esc(order(b.order_id)?.code)}</b>${cbsWarning(b)}</td><td>${esc(isBombe(b)?'BOMBE / '+b.bombe_model:detailFor(b))}</td><td>${isBombe(b)?'—':bar(b)+' BAR'}</td><td>${b.target}</td><td>${shipped(b)}</td><td><div class="progress"><i style="width:${pct}%"></i></div><small>${pct}%</small></td><td>${esc(b.end_date||'—')}</td></tr>`}).join('')||'<tr><td colspan="7">Henüz üretim planı bulunmuyor.</td></tr>'}</tbody></table></div>`}
const localISO=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let historyDate=localISO(new Date());
let perfMonth=new Date().toISOString().slice(0,7);
let perfData=[];
let perfLoadedMonth='';
let backupMonth=localISO(new Date()).slice(0,7);
function cbsPerfHTML(){
  const records=perfData.filter(h=>h.process_name&&[...STAGES,...BOMBE_STAGES].includes(h.process_name)&&Number(h.quantity_change)>0&&['Proses adedi eklendi','Proses adedi güncellendi'].includes(h.action_type));
  const sums=[...STAGES,'KORDON ÇEKME'].map(name=>({name,total:records.filter(h=>h.process_name===name).reduce((s,h)=>s+Number(h.quantity_change||0),0)}));
  const max=Math.max(1,...sums.map(x=>x.total));
  const shippedRecords=records.filter(h=>h.process_name==='SEVKİYAT'&&Number(h.litre)>0);
  const litres=[...new Set([...LITRES,...shippedRecords.map(h=>Number(h.litre))])].sort((a,b)=>a-b);
  const byLitre=litres.map(litre=>({litre,total:shippedRecords.filter(h=>Number(h.litre)===litre).reduce((s,h)=>s+Number(h.quantity_change||0),0)}));
  const litreMax=Math.max(1,...byLitre.map(x=>x.total));
  const totalShipped=byLitre.reduce((s,x)=>s+x.total,0);
  const litreHTML=`<div class="panel"><h2>Tüp Hacmine Göre Aylık Sevkiyat</h2><p class="muted small">${esc(perfMonth)} ayında SEVKİYAT prosesine kaydedilen adetler; arşivlenmiş siparişler de dahildir. Silinen girişler hariçtir.</p><div class="cbs-bars">${byLitre.map(x=>`<div class="cbs-bar-row"><span>${x.litre} LT</span><div class="cbs-bar-track"><i style="width:${Math.max(0,Math.round(x.total/litreMax*100))}%"></i></div><b>${x.total.toLocaleString('tr-TR')}</b></div>`).join('')}</div><p style="margin-top:18px;font-weight:800">TOPLAM SEVKİYAT: ${totalShipped.toLocaleString('tr-TR')} ADET</p></div>`;
  return `<div class="panel"><h2>Proseslere Göre Aylık Adetler</h2><p class="muted small">${esc(perfMonth)} ayında yapılan proses girişleri gösterilir. Her proses ayrı değerlendirilir; adetler birbirine eklenmez.</p><div class="cbs-bars">${sums.map(x=>`<div class="cbs-bar-row"><span>${esc(x.name)}</span><div class="cbs-bar-track"><i style="width:${Math.round(x.total/max*100)}%"></i></div><b>${x.total.toLocaleString('tr-TR')}</b></div>`).join('')}</div></div>${litreHTML}`;
}
async function cbsLoadMonth(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Geçerli bir ay seçin.');
  const [year,mon]=month.split('-').map(Number);
  const next=mon===12?`${year+1}-01`:`${year}-${String(mon+1).padStart(2,'0')}`;
  const start=`${month}-01T00:00:00+03:00`,finish=`${next}-01T00:00:00+03:00`;
  const records=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await sb.from('production_history').select('id,created_at,order_code,litre,product_type,bombe_model,process_name,action_type,quantity_change').gte('created_at',start).lt('created_at',finish).order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+499);
    if(error)throw error;records.push(...(data||[]));if(!data||data.length<500)break;
  }
  perfData=records;perfLoadedMonth=month;
  const target=$('#perfResult');if(target)target.innerHTML=cbsPerfHTML();
}
function cbsRenderPerformance(){
  const el=$('#performance');if(!el)return;
  el.innerHTML=`<div class="panel"><h2>Aylık Üretim Performansı</h2><p class="muted small">Rapor, işlemlerin yapıldığı tarihe göre hazırlanır. Arşivleme tarihi dikkate alınmaz. Silinmiş geçmiş girişleri rapora dahil değildir.</p><div class="cbs-toolbar"><label>Rapor ayı <input id="perfMonth" type="month" value="${esc(perfMonth)}"></label><button type="button" id="perfLoad" class="btn">Raporu Göster</button></div></div><div id="perfResult">${perfLoadedMonth===perfMonth?cbsPerfHTML():'<div class="panel"><p class="muted">Ayı seçip Raporu Göster düğmesine basın.</p></div>'}</div>`;
}
function historyTable(){
  const rows=state.history.filter(h=>!historyDate||localISO(new Date(h.created_at))===historyDate);
  return `<div class="tablewrap"><table><thead><tr><th>Tarih / Saat</th><th>Sipariş</th><th>Proses / İşlem</th><th>Adet</th><th>İşlem</th></tr></thead><tbody>${rows.map(h=>{
    const canEditPlan=writable()&&h.batch_id!=null&&['Üretim planı oluşturuldu','Üretim planı güncellendi','Üretim planı miktarı düzeltildi'].includes(h.action_type)&&!!batch(Number(h.batch_id))&&!order(batch(Number(h.batch_id)).order_id)?.archived_at;
     const canDelete=admin()&&h.batch_id!=null&&Number(h.quantity_change)>0&&['Proses adedi eklendi','Proses adedi güncellendi'].includes(h.action_type);
    return `<tr><td>${esc(new Date(h.created_at).toLocaleString('tr-TR'))}</td><td>${esc(h.order_code)}${h.product_type==='BOMBE'?' / BOMBE / '+esc(h.bombe_model||''):(h.litre?' / '+esc(h.litre)+' LT':'')+(h.pressure_bar?' / '+esc(h.pressure_bar)+' BAR':'')}</td><td>${esc(h.process_name||h.action_type)}</td><td><b>${h.quantity_change==null?(h.new_quantity??'—'):(h.quantity_change>0?'+':'')+h.quantity_change}</b></td><td>${canEditPlan?`<button type="button" class="btn secondary" data-edit-plan="${h.batch_id}">Plan Adedini Düzenle</button> `:''}${canDelete?`<button type="button" class="btn secondary" data-delete-process-entry="${h.id}">Sil</button>`:(!canEditPlan?'—':'')}</td></tr>`;
  }).join('')||'<tr><td colspan="5">Bu tarihte kayıt bulunmuyor.</td></tr>'}</tbody></table></div>`;
}
async function logHistory({b=null,code=null,action,process=null,oldQty=null,newQty=null,change=null}){check(await sb.from('production_history').insert({batch_id:b?.id||null,order_code:code||order(b?.order_id)?.code||'—',litre:b?.litre||null,pressure_bar:b&&!isBombe(b)?bar(b):null,product_type:b?.product_type||null,bombe_model:b?.bombe_model||null,process_name:process,action_type:action,old_quantity:oldQty,new_quantity:newQty,quantity_change:change}))}
let stockLoadError='';
let stockSelectedId='';
function stockNumber(n){return Number(n||0).toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:2})}
function stockOptions(){return state.stockItems.map(x=>`<option value="${x.id}" ${String(x.id)===String(stockSelectedId)?'selected':''}>${esc(x.name)}</option>`).join('')}
function stockCurrent(){return state.stockItems.find(x=>String(x.id)===String(stockSelectedId))||state.stockItems[0]}
function cbsTons(x){const kg=Number(x.kg_per_unit);return Number.isFinite(kg)&&kg>0?(Number(x.quantity||0)*kg/1000):null;}
function cbsTonsText(x){const n=cbsTons(x);return n===null?'Birim ağırlığı girilmedi':stockNumber(n)+' ton';}
function stockDashboard(){const x=stockCurrent();return `<div class="panel"><h2>📦 Sac Stoğu / Malzeme Stok Durumu</h2>${stockLoadError?`<p class="muted">Stok bağlantısı kurulamadı: ${esc(stockLoadError)}</p>`:x?`<label>Malzeme seçin <select id="stockDashboardSelect" style="width:100%;max-width:650px">${stockOptions()}</select></label><div style="margin-top:15px"><span class="muted">KALAN STOK</span><div style="font-size:30px;font-weight:800">${stockNumber(x.quantity)} ${esc(x.unit)}</div><p class="muted">${esc(x.name)} · <b>${cbsTonsText(x)}</b></p></div>`:'<p class="muted">Henüz malzeme bulunmuyor. Önce Supabase stok kurulumunu yapın.</p>'}</div>`}
function stockManagement(){const x=stockCurrent();return `<div class="panel"><h2>📦 Sac Stok Yönetimi</h2>${stockLoadError?`<p class="muted">Stok bilgileri yüklenemedi: ${esc(stockLoadError)}. Önce stok SQL kurulumunu kontrol edin.</p>`:x?`${writable()?`<form id="stockForm" class="form"><label>Malzeme<select name="item_id" id="stockManageSelect" required>${stockOptions()}</select></label><label>İşlem<select name="movement_type" required><option value="IN">Stok Girişi (+)</option><option value="OUT">Stok Çıkışı (-)</option></select></label><label>Miktar<input name="quantity" type="number" min="0.01" step="0.01" required placeholder="Örnek: 2,5 için 2.5 yazın"></label><label>Açıklama (isteğe bağlı)<input name="note" maxlength="250" placeholder="Örn. Üretimde kullanıldı"></label><button class="btn" type="submit">Stok İşlemini Kaydet</button></form>`:''}<p class="muted">Seçili malzemenin kalan stoğu: <b>${stockNumber(x.quantity)} ${esc(x.unit)}</b></p>${writable()?`<form id="stockWeightForm" class="form"><label>1 stok biriminin ağırlığı (kg)<input type="number" name="kg_per_unit" min="0.000001" step="any" value="${x.kg_per_unit??''}" required></label><input type="hidden" name="item_id" value="${x.id}"><button class="btn">Birim Ağırlığını Kaydet</button></form>`:''}<h3>Mevcut Malzemeler</h3><div class="tablewrap"><table><thead><tr><th>Malzeme</th><th>Kalan</th><th>Birim</th><th>Tonaj</th></tr></thead><tbody>${state.stockItems.map(i=>`<tr><td>${esc(i.name)}</td><td>${stockNumber(i.quantity)}</td><td>${esc(i.unit)}</td><td>${cbsTonsText(i)}</td></tr>`).join('')}</tbody></table></div><h3>Son 100 Stok İşlemi</h3><div class="tablewrap"><table><thead><tr><th>Tarih</th><th>Malzeme</th><th>İşlem</th><th>Miktar</th><th>Açıklama</th>${admin()?'<th>İşlem</th>':''}</tr></thead><tbody>${state.stockMovements.map(m=>{const item=state.stockItems.find(i=>i.id===m.item_id);return `<tr><td>${esc(new Date(m.created_at).toLocaleString('tr-TR'))}</td><td>${esc(item?.name||'—')}</td><td>${m.movement_type==='IN'?'Giriş':'Çıkış'}</td><td>${m.movement_type==='IN'?'+':'−'}${stockNumber(m.quantity)} ${esc(item?.unit||'')}</td><td>${esc(m.note||'—')}</td>${admin()?`<td><button type="button" class="btn secondary" data-delete-stock-movement="${m.id}">Sil</button></td>`:''}</tr>`}).join('')||`<tr><td colspan="${admin()?6:5}">Henüz stok hareketi yok.</td></tr>`}</tbody></table></div>`:'<p class="muted">Stok malzemeleri henüz yüklenmedi.</p>'}</div>`}
function render(){const planned=activeBatches().reduce((sum,b)=>sum+(Number(b.target)||0),0),delivered=activeBatches().reduce((sum,b)=>sum+shipped(b),0),readyCount=activeBatches().reduce((sum,b)=>sum+ready(b),0);$('#dashboard').innerHTML=`<div class="stats"><div class="stat"><div class="label">TOPLAM SİPARİŞ</div><div class="number">${state.orders.filter(o=>!o.archived_at).length}</div><div class="meta">Aktif sipariş</div></div><div class="stat"><div class="label">ÜRETİM GRUBU</div><div class="number">${activeBatches().length}</div><div class="meta">Tüp ve bombe planı</div></div><div class="stat"><div class="label">PLANLANAN ÜRÜN</div><div class="number">${planned}</div><div class="meta">Toplam sipariş adedi</div></div><div class="stat" id="cbsReadyButton" role="button" tabindex="0" title="Sipariş ve adet detaylarını göster" style="cursor:pointer"><div class="label">SEVKİYATA HAZIR ↗</div><div class="number">${readyCount}</div><div class="meta">Paketlenen, henüz sevk edilmeyen tüp/tank</div></div><div class="stat"><div class="label">SEVK EDİLENLER</div><div class="number">${delivered}</div><div class="meta">SEVKİYAT prosesine ulaşan adet</div></div></div>${stockDashboard()}<div id="cbsReadyDetails" class="hidden"></div><div class="panel"><h2>Üretim Durumu</h2>${summaryTable()}</div>`;
$('#orders').innerHTML=`${writable()?`<div class="panel"><h2>Sipariş Oluştur</h2><form id="orderForm" class="form"><label>Sipariş kodu<input name="code" placeholder="CBS317" maxlength="40" required></label><button class="btn">+ Sipariş Ekle</button></form></div><div class="panel"><h2>Sipariş Kodu Düzenle</h2><form id="renameForm" class="form"><label>Sipariş<select name="id" required>${ordersOptions()}</select></label><label>Yeni kod<input name="code" maxlength="40" required></label><button type="submit" class="btn">Kaydet</button><p id="renameStatus" role="status" aria-live="polite" style="width:100%;font-weight:700"></p></form></div><div class="panel"><h2>Üretim Planı (Tüp / Bombe / Tank)</h2><form id="batchForm" class="form"><label>Sipariş<select name="order_id" required>${ordersOptions()}</select></label><label>Ürün tipi<select name="product_type" id="productType"><option value="TUP">Tüp</option><option value="BOMBE">Bombe</option><option value="TANK">Tank</option></select></label><label data-tup>Litre<select name="litre" id="batchLitre">${options(LITRES.map(n=>[n,n+' LT']))}</select></label><label data-tup>Basınç türü<select name="pressure_bar"><option value="42">42 BAR</option><option value="25">25 BAR</option><option value="11">11 BAR</option></select></label><label data-tup data-120 hidden>120 L çapı<select name="diameter_mm"><option value="">Çap seçin</option><option value="323">323 mm</option><option value="355">355 mm</option><option value="406">406 mm</option></select></label><label data-tup data-1000 hidden>1000 L türü<select name="litre_variant">${options(VARIANTS)}</select></label><label data-bombe hidden>Bombe modeli<select name="bombe_model">${options(BOMBE_MODELS.map(x=>[x,x]))}</select></label><label>Planlanan adet<input type="number" name="target" min="0" required></label><label>Başlangıç<input type="date" name="start_date"></label><label>Tahmini Bitiş Tarihi<input type="date" name="end_date"></label><button class="btn">Planı Kaydet</button></form><p class="muted small">Aynı sipariş ve aynı ürün özelliği tekrar kaydedilirse mevcut plan güncellenir.</p></div>`:''}<div class="panel"><h2>Kayıtlı Üretim Planları</h2>${summaryTable()}</div>${admin()?`<div class="panel"><h2>Sipariş ve Üretim Grubu İşlemleri</h2><p class="muted small">Silme işlemi bağlı üretim gruplarını, proses adetlerini ve seri numaralarını da kalıcı olarak kaldırabilir. Tamamlanan siparişleri saklamak için arşivleyin.</p><div class="tablewrap"><table><thead><tr><th>Sipariş</th><th>İşlem</th></tr></thead><tbody>${state.orders.filter(o=>!o.archived_at).map(o=>`<tr><td>${esc(o.code)}</td><td><button type="button" class="btn secondary" data-archive-order="${o.id}">Arşivle</button> <button type="button" class="btn secondary" data-del-order="${o.id}">Sil</button></td></tr>`).join('')||'<tr><td colspan="2">Aktif sipariş yok.</td></tr>'}</tbody></table></div><h2>Üretim Grubu Silme</h2><div class="tablewrap"><table><thead><tr><th>Sipariş / Litre</th><th>İşlem</th></tr></thead><tbody>${activeBatches().map(b=>`<tr><td>${esc(batchLabel(b))}</td><td><button type="button" class="btn secondary" data-del-batch="${b.id}">Sil</button></td></tr>`).join('')||'<tr><td colspan="2">Üretim grubu yok.</td></tr>'}</tbody></table></div></div><div class="panel"><h2>Arşivlenen Siparişler</h2><div class="tablewrap"><table><thead><tr><th>Sipariş</th><th>Arşiv Tarihi</th><th>İşlem</th></tr></thead><tbody>${state.orders.filter(o=>o.archived_at).map(o=>`<tr><td>${esc(o.code)}</td><td>${fmt(o.archived_at)}</td><td><button type="button" class="btn secondary" data-restore-order="${o.id}">Geri Yükle</button></td></tr>`).join('')||'<tr><td colspan="3">Arşivlenmiş sipariş yok.</td></tr>'}</tbody></table></div></div>`:''}`;
$('#orders').insertAdjacentHTML('beforeend',stockManagement());
 // Mevcut üretim grubunun ürün bilgilerini, ID ve proses kayıtlarını koruyarak düzenleme.
 if(writable()){
  $('#orders').insertAdjacentHTML('beforeend',`<div class="panel"><h2>Ürün Bilgilerini Düzenle</h2><p class="muted small">Mevcut üretim grubunu seçin. Sipariş, planlanan adet ve proses kayıtları korunur.</p><form id="editProductForm" class="form"><label>Üretim grubu<select name="batch_id" id="editProductBatch" required>${batchesOptions()}</select></label><label>Ürün tipi<select name="product_type" id="editProductType"><option value="TUP">Tüp</option><option value="TANK">Tank</option><option value="BOMBE">Bombe</option></select></label><label data-edit-tup>Litre<select name="litre">${options(LITRES.map(n=>[n,n+' LT']))}</select></label><label data-edit-tup>Basınç<select name="pressure_bar"><option value="42">42 BAR</option><option value="25">25 BAR</option><option value="11">11 BAR</option></select></label><label data-edit-120 hidden>120 L çapı<select name="diameter_mm"><option value="">Çap seçin</option><option value="323">323 mm</option><option value="355">355 mm</option><option value="406">406 mm</option></select></label><label data-edit-1000 hidden>1000 L türü<select name="litre_variant">${options(VARIANTS)}</select></label><label data-edit-bombe hidden>Bombe modeli<select name="bombe_model">${options(BOMBE_MODELS.map(x=>[x,x]))}</select></label><button type="submit" class="btn">Ürün Bilgilerini Kaydet</button></form><p id="editProductStatus" role="status" aria-live="polite"></p></div>`);
  cbsFillEditProduct();
 }

 $('#serials').innerHTML=`${writable()?`<div class="panel"><h2>Proses Adet Girişi</h2><p class="muted small">Her prosese ulaşan toplam ürün adedini girin. Önceki aşamalara eksik giriş varsa sistem onları da bu adede tamamlar.</p><form id="processForm" class="form"><label>Sipariş / Ürün<select name="batch_id" id="processBatch" required>${batchesOptions()}</select></label><label>Proses<select name="process_name" id="processName" required>${options(STAGES.map(x=>[x,x]))}</select></label><label>Bu prosese eklenecek adet<input type="number" name="quantity" min="0" step="1" required placeholder="1"></label><button class="btn">Proses Adedini Kaydet</button></form></div>`:''}<div class="panel"><h2>Üretimdeki Tüp ve Bombelerin Durumu</h2><p class="muted small">Bu aşamada bekleyen: sonraki prosese geçmemiş adet. Toplamlar sipariş planına göre gösterilir; sonraki prosese sonradan girilen adet önceki aşamalarda tekrar sayılmaz.</p>${activeBatches().map(b=>`<div class="panel"><h2>${esc(batchLabel(b))} · ${b.target} adet</h2><div class="progress"><i style="width:${progress(b)}%"></i></div><p class="muted">Genel proses ilerlemesi: <b>${progress(b)}%</b> · Son prosese ulaşan: <b>${shipped(b)}</b></p>${processTable(b)}</div>`).join('')||'<p>Henüz üretim grubu bulunmuyor.</p>'}</div>`;
 $('#serials').insertAdjacentHTML('beforeend',cbsQualityPanel());
 $('#board').innerHTML=`<div class="cbs-board-grid">${activeBatches().map(b=>{const q=quantities(b),pct=progress(b);const balance=processBalance(b);const entries=stagesFor(b).map((st,i)=>({st,q:balance.atStage[i]}));return `<article class="cbs-board-card"><div class="cbs-board-top"><div><div class="cbs-board-code">${esc(order(b.order_id)?.code)}</div><div class="cbs-board-sub">${esc(detailFor(b))}</div></div><div class="cbs-board-pill">${pct}% ilerleme ${cbsWarning(b)}</div></div><div class="cbs-board-kpis"><div><small>PLAN</small><b>${b.target}</b></div><div><small>SON PROSES</small><b>${shipped(b)}</b></div><div><small>TAHMİNİ BİTİŞ</small><b>${esc(b.end_date||'—')}</b></div></div><div class="progress"><i style="width:${pct}%"></i></div><div class="cbs-stage-row"><span>Henüz üretime girmeyen</span><strong>${balance.notStarted}</strong></div><div class="cbs-stage-head"><span>PROSES</span><span>BU AŞAMADA BEKLEYEN</span></div>${entries.map(x=>`<div class="cbs-stage-row"><span>${esc(x.st)}</span><strong>${x.q}</strong></div>`).join('')}</article>`}).join('')||'<div class="panel">Henüz üretim planı bulunmuyor.</div>'}</div>`;
cbsRenderPerformance();cbsToggleProductForm();cbsSyncProcess();
$('#board').insertAdjacentHTML('afterbegin',`<div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><h2 style="margin:0">Üretim Panosu</h2><p class="muted small" style="margin:5px 0 0">Ekranda görünen üretim durumunu PDF olarak kaydedin.</p></div><button type="button" id="boardPdf" class="btn">PDF Rapor Al</button></div>`);
 $('#users').innerHTML=admin()?`<div class="panel"><h2>🛠️ Sistem Bakım Modu</h2><p class="muted small">Bakım sırasında personelin ekranı geçici olarak kapatılır ve veritabanına yeni kayıt yapılması engellenir. Açmadan önce personele haber verin.</p><div class="cbs-maintenance-switch"><b id="cbsMaintenanceStatus">Durum kontrol ediliyor...</b><p><button type="button" class="btn" id="cbsMaintenanceToggle">Bakım durumunu değiştir</button></p></div></div><div class="panel"><h2>⏳ Bekleyen Onaylar</h2><p class="muted small">Yeni kayıtlar onaylanana kadar sisteme giremez. Onaylamadan önce kişinin e-posta adresini doğrulayın.</p><div class="tablewrap"><table><thead><tr><th>E-posta</th><th>Yetki</th><th>İşlem</th></tr></thead><tbody>${state.profiles.filter(p=>!p.active).map(p=>`<tr><td>${esc(p.email)}</td><td><select class="stage-select" data-pending-role="${p.id}">${options([['viewer','Görüntüleyici'],['editor','Yetkili Personel'],['admin','Yönetici']],p.role)}</select></td><td><button type="button" class="btn" data-approve-user="${p.id}">Onayla</button> <button type="button" class="btn secondary" data-reject-user="${p.id}">Reddet</button></td></tr>`).join('')||'<tr><td colspan="3">Bekleyen başvuru yok.</td></tr>'}</tbody></table></div></div><div class="panel"><h2>Kullanıcı Yetkileri</h2><p class="muted small">🟢 Çevrim içi · ⚪ Çevrim dışı (yaklaşık 1 dakika içinde güncellenir). Hesap Aktif kutusundan farklıdır.</p><div class="tablewrap"><table><thead><tr><th>E-posta</th><th>Rol</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${state.profiles.map(p=>`<tr><td><span class="cbs-presence-dot" data-presence-id="${p.id}" title="Çevrim dışı"></span>${esc(p.email)}${p.id===profile.id?' (Sen)':''}</td><td><select class="stage-select" data-role="${p.id}" ${p.id===profile.id?'disabled':''}>${options([['admin','Yönetici'],['editor','Yetkili Personel'],['viewer','Görüntüleyici']],p.role)}</select></td><td><label><input type="checkbox" data-active="${p.id}" ${p.active?'checked':''} ${p.id===profile.id?'disabled':''}> Aktif</label></td><td><button class="btn secondary" data-saveuser="${p.id}" ${p.id===profile.id?'disabled':''}>Kaydet</button> <button type="button" class="btn secondary" data-delete-user="${p.id}" ${p.id===profile.id?'disabled':''}>Hesabı Sil</button></td></tr>`).join('')}</tbody></table></div></div>`:'';
 $('#audit').innerHTML=`<div class="panel"><h2>Günlük İşlem Geçmişi</h2><p class="muted small">Yalnızca sipariş yönetimi ve proses girişleri. Tarih seçerek geçmişi inceleyebilirsiniz. Adet, proses için yapılan net değişimdir.</p><label>Tarih seçin <input id="historyDate" type="date" value="${esc(historyDate)}"></label><button type="button" class="btn secondary" id="historyAll">Tüm Tarihler</button><div id="historyRows">${historyTable()}</div><div style="display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid #567"><label>Yedeklenecek ay <input id="backupMonth" type="month" value="${esc(backupMonth)}"></label><button type="button" class="btn" id="backupExcel">Excel'e Yedekle</button></div><p class="muted small">Yalnızca seçilen ayda yapılan işlem geçmişi indirilir. Arşiv tarihi dikkate alınmaz.</p></div>`;
$$('section#dashboard,section#orders,section#serials,section#board,section#users,section#audit,section#performance').forEach(x=>x.classList.toggle('hidden',x.id!==page));document.querySelectorAll('[data-presence-id]').forEach(el=>{const online=cbsOnlineIds.has(el.dataset.presenceId);el.classList.toggle('online',online);el.title=online?'Çevrim içi':'Çevrim dışı';});}
function showPage(p){if(!['dashboard','orders','serials','board','performance','users','audit'].includes(p))p='dashboard';if(p==='users'&&!admin())p='dashboard';if(p==='orders'&&!writable())p='dashboard';page=p;const newOrderButton=document.querySelector('#newOrder');if(newOrderButton)newOrderButton.hidden=!(p==='orders'&&writable());const passwordPanel=document.querySelector('#accountPasswordPanel');if(passwordPanel)passwordPanel.classList.add('hidden');$$('#menu [data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===p));const names={dashboard:'Genel Bakış',orders:'Sipariş Yönetimi',serials:'Proses Takibi',board:'Üretim Panosu',users:'Kullanıcı Yönetimi',audit:'İşlem Geçmişi',performance:'Aylık Performans'};$('#title').textContent=names[p];$$('section#dashboard,section#orders,section#serials,section#board,section#users,section#audit,section#performance').forEach(x=>x.classList.toggle('hidden',x.id!==p))}
async function mutation(fn){if(!writable())throw Error('Bu işlem için yetkiniz yok.');await fn();await refresh();toast('Kayıt başarıyla güncellendi.')}
async function submitForm(form){const fd=new FormData(form),obj=Object.fromEntries(fd.entries());switch(form.id){case 'orderForm':case 'quickOrder':await mutation(async()=>{check(await sb.from('orders').insert({code:obj.code.trim().toUpperCase()}));await logHistory({code:obj.code.trim().toUpperCase(),action:'Sipariş oluşturuldu'})});$('#modal').close();break;
case 'renameForm':{
  const orderId=Number(obj.id);
  const previous=order(orderId);
  const newCode=String(obj.code||'').trim().toLocaleUpperCase('tr-TR');
  if(!previous||!Number.isSafeInteger(orderId))throw Error('Düzenlenecek sipariş bulunamadı.');
  if(!newCode||newCode.length>40)throw Error('Yeni sipariş kodu 1–40 karakter olmalıdır.');
  if(previous.code===newCode)throw Error('Yeni sipariş kodu mevcut kodla aynı.');
  if(state.orders.some(o=>o.id!==orderId&&o.code===newCode))throw Error('Bu sipariş kodu zaten kullanılıyor.');
  const btn=form.querySelector('button[type="submit"],button:not([type])');
  if(btn){btn.disabled=true;btn.textContent='Güncelleniyor...';}
  try{
    const {data,error}=await sb.from('orders').update({code:newCode}).eq('id',orderId).select('id,code').single();
    if(error)throw Error(error.code==='PGRST116'?'Sipariş kodu güncellenemedi: veritabanı güncelleme iznini kontrol edin.':error.message);
    if(!data||data.code!==newCode)throw Error('Sipariş kodu veritabanında güncellenemedi.');
    try{await logHistory({code:newCode,action:`Sipariş kodu değiştirildi (${previous.code})`});}
    catch(historyError){console.warn('Sipariş kodu güncellendi, işlem geçmişi yazılamadı:',historyError);toast('Kod değişti ancak işlem geçmişi kaydedilemedi: '+historyError.message);}
    await refresh();
    toast(`Sipariş kodu değiştirildi: ${previous.code} → ${newCode}`);
  }finally{if(btn){btn.disabled=false;btn.textContent='Kaydet';}}
  break;
 }
case 'batchForm':{
 const isBombeType=obj.product_type==='BOMBE',isTankType=obj.product_type==='TANK';
 const rec={order_id:Number(obj.order_id),product_type:isBombeType?'BOMBE':isTankType?'TANK':'TUP',litre:isBombeType?null:Number(obj.litre),pressure_bar:isBombeType?null:Number(obj.pressure_bar),bombe_model:isBombeType?String(obj.bombe_model):null,diameter_mm:!isBombeType&&Number(obj.litre)===120?Number(obj.diameter_mm)||null:null,litre_variant:!isBombeType&&Number(obj.litre)===1000?String(obj.litre_variant):null,target:Number(obj.target),start_date:obj.start_date||null,end_date:obj.end_date||null};
 if(!Number.isSafeInteger(rec.order_id)||rec.order_id<=0||!Number.isSafeInteger(rec.target)||rec.target<0)throw Error('Sipariş ve adet bilgilerini kontrol edin.');
 if(isTankType&&Number(obj.litre)!==1000)throw Error('Tank ürün tipi yalnızca 1000 LT için kullanılabilir.');
  if(isBombeType&&!BOMBE_MODELS.includes(rec.bombe_model))throw Error('Geçerli bombe modeli seçin.');
 if(!isBombeType&&(!LITRES.includes(rec.litre)||![11,25,42].includes(rec.pressure_bar)))throw Error('Litre ve basınç seçimini kontrol edin.');
 if(!isBombeType&&rec.litre===120&&![323,355,406].includes(rec.diameter_mm))throw Error('120 litre için çap seçin.');
 if(!isBombeType&&rec.litre===1000&&!VARIANTS.some(x=>x[0]===rec.litre_variant))throw Error('1000 litre türünü seçin.');
 if(rec.start_date&&rec.end_date&&rec.end_date<rec.start_date)throw Error('Bitiş tarihi başlangıçtan önce olamaz.');
 await mutation(async()=>{
  const previous=state.batches.find(b=>b.order_id===rec.order_id&&(isBombeType?isBombe(b)&&b.bombe_model===rec.bombe_model:!isBombe(b)&&b.product_type===rec.product_type&&b.litre===rec.litre&&bar(b)===rec.pressure_bar&&(b.diameter_mm??null)===rec.diameter_mm&&(b.litre_variant??null)===rec.litre_variant));
  const saved=previous?check(await sb.from('batches').update(rec).eq('id',previous.id).select('*').single()):check(await sb.from('batches').insert(rec).select('*').single());
  await logHistory({b:saved,action:previous?'Üretim planı güncellendi':'Üretim planı oluşturuldu',oldQty:previous?.target??null,newQty:rec.target,change:previous?rec.target-Number(previous.target):rec.target});
 });break}
case 'processForm': {
  const batchId = Number(obj.batch_id);
  const processName = String(obj.process_name);
  const quantity = Number(obj.quantity);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) throw Error('Geçersiz üretim grubu.');
  if (!stagesFor(batch(batchId)).includes(processName)) throw Error('Geçersiz proses.');
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw Error('Geçerli bir üretim adedi girin.');
  await mutation(async () => {
    check(await sb.rpc('cbs_save_process', {
      p_batch_id: batchId,
      p_process_name: processName,
      p_quantity: quantity
    }));
  });
  break;
}
case 'serialForm':await mutation(async()=>check(await sb.from('serials').insert({batch_id:Number(obj.batch_id),serial:obj.serial.trim().toUpperCase(),stage:obj.stage})));break;}}
function cbsConfirm(message){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.setAttribute('role','presentation');
    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(3,12,28,.78);display:flex;align-items:center;justify-content:center;padding:20px';
    const panel=document.createElement('div');
    panel.setAttribute('role','alertdialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','İşlem onayı');
    panel.style.cssText='background:#14263b;color:#fff;border:1px solid #46748a;border-radius:14px;padding:24px;width:min(440px,100%);box-shadow:0 20px 70px #0009;font:inherit';
    const title=document.createElement('h2');title.textContent='İşlemi onayla';title.style.margin='0 0 14px';
    const msg=document.createElement('p');msg.textContent=message;msg.style.cssText='line-height:1.55;white-space:pre-wrap;margin:0 0 22px';
    const actions=document.createElement('div');actions.style.cssText='display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='İptal';cancel.style.cssText='padding:11px 18px;border-radius:8px;border:1px solid #698296;background:#263b50;color:white;cursor:pointer';
    const ok=document.createElement('button');ok.type='button';ok.textContent='Evet, onaylıyorum';ok.style.cssText='padding:11px 18px;border-radius:8px;border:0;background:#b93241;color:white;font-weight:700;cursor:pointer';
    const finish=value=>{document.removeEventListener('keydown',onKey);overlay.remove();resolve(value)};
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(false)}};
    cancel.addEventListener('click',()=>finish(false));ok.addEventListener('click',()=>finish(true));
    overlay.addEventListener('click',e=>{if(e.target===overlay)finish(false)});
    actions.append(cancel,ok);panel.append(title,msg,actions);overlay.append(panel);document.body.append(overlay);
    document.addEventListener('keydown',onKey);cancel.focus();
  });
}
function exportBoardPDF(){
  const board=$('#board');
  if(!board){toast('Üretim panosu bulunamadı.');return}
  const cards=board.querySelector('.cbs-board-grid');
  if(!cards){toast('Üretim panosu henüz hazır değil.');return}
  const win=window.open('','_blank');
  if(!win){toast('PDF penceresi engellendi. Tarayıcıda açılır pencerelere izin verin.');return}
  const now=new Date().toLocaleString('tr-TR');
  const content=cards.cloneNode(true);
  content.querySelectorAll('button,script,input,select').forEach(el=>el.remove());
  const html=`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>CBS Üretim Panosu - ${esc(now)}</title><style>
  *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#152334;background:white;margin:0;padding:22px;font-size:12px}
  header{border-bottom:3px solid #163d58;padding-bottom:12px;margin-bottom:18px}h1{font-size:23px;margin:0 0 6px}header p{margin:0;color:#596a7c}
  .cbs-board-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
  .cbs-board-card{border:1px solid #cdd8e1;border-radius:10px;padding:15px;break-inside:avoid;page-break-inside:avoid;min-width:0}.cbs-board-top,.cbs-board-kpis,.cbs-stage-row,.cbs-stage-head{display:flex;justify-content:space-between;gap:10px}.cbs-board-code{font-size:22px;font-weight:800}.cbs-board-sub{font-size:15px;font-weight:700}.cbs-board-kpis{padding:12px 0}.cbs-board-kpis div{display:flex;flex-direction:column}.cbs-stage-row{border-bottom:1px solid #ddd;padding:4px 0}.cbs-stage-head{font-weight:700;border-bottom:2px solid #aaa;padding:7px 0}
  .boardcode{font-size:21px;font-weight:800;color:#153d58}.boardlitre{font-size:17px;font-weight:bold;margin:5px 0 9px}
  .muted{color:#546579;font-size:11px}.progress{height:12px;background:#e4ebf1;border-radius:20px;overflow:hidden;margin:10px 0}
  .progress i{display:block;height:100%;background:#1586a8;border-radius:20px}
  .stage{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e1e8ed;padding:7px 0;font-size:11px}
  .stage span{flex:1}.stage strong{text-align:right;white-space:normal}p{line-height:1.4}
  footer{font-size:10px;color:#617083;border-top:1px solid #dae1e7;margin-top:18px;padding-top:9px}
  @page{size:A4 landscape;margin:12mm}
  @media print{body{padding:0}.cbs-board-grid{gap:12px}.cbs-board-card{print-color-adjust:exact;-webkit-print-color-adjust:exact}.progress,.progress i{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  @media(max-width:620px){.cbs-board-grid{grid-template-columns:1fr}}
  </style></head><body><header><h1>ÇUKUROVA BOMBE SANAYİ</h1><p>Üretim Panosu Raporu · ${esc(now)}</p></header>${content.outerHTML}<footer>Üretim Panosu · Görüntülenen aktif üretim grupları</footer><script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),250)});<\/script></body></html>`;
  win.document.open();win.document.write(html);win.document.close();
}
function showTemporaryPassword(email,password){
  const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:100000;background:#000b;display:flex;align-items:center;justify-content:center;padding:20px';
  const panel=document.createElement('div');panel.style.cssText='background:#14263b;color:white;border-radius:16px;padding:26px;width:min(460px,100%);box-shadow:0 20px 60px #0009';
  const title=document.createElement('h2');title.textContent='Personel hesabı oluşturuldu';
  const description=document.createElement('p');description.textContent='Bu geçici şifre yalnızca şimdi gösterilir. Güvenli şekilde personele iletin.';
  const details=document.createElement('p');details.style.cssText='overflow-wrap:anywhere;line-height:1.8';
  const emailLabel=document.createElement('strong');emailLabel.textContent=email;
  const pass=document.createElement('code');pass.textContent=password;pass.style.cssText='display:block;background:#263e54;padding:12px;border-radius:8px;font-size:18px;user-select:all;margin-top:8px';
  details.append(emailLabel,pass);
  const copy=document.createElement('button');copy.type='button';copy.className='btn';copy.textContent='Şifreyi Kopyala';copy.onclick=async()=>{try{await navigator.clipboard.writeText(password);copy.textContent='Kopyalandı ✓'}catch(_){toast('Şifreyi seçip kopyalayın.')}};
  const close=document.createElement('button');close.type='button';close.className='btn secondary';close.textContent='Kapattım';close.style.marginLeft='10px';close.onclick=()=>overlay.remove();
  panel.append(title,description,details,copy,close);overlay.append(panel);document.body.append(overlay);
}
// Seçilen ayın işlem geçmişini Supabase'den sayfa sayfa çekip gerçek XLSX oluşturur.
async function cbsLoadXLSX(){
  if(window.XLSX?.utils?.aoa_to_sheet)return;
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload=resolve;script.onerror=()=>reject(Error('Excel kütüphanesi yüklenemedi. İnternet bağlantısını kontrol edin.'));
    document.head.appendChild(script);
  });
  if(!window.XLSX?.utils?.aoa_to_sheet)throw Error('Excel kütüphanesi açılamadı.');
}
async function exportHistoryExcel(){
  const month=document.querySelector('#backupMonth')?.value||backupMonth;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Geçerli bir ay seçin.');
  backupMonth=month;
  const [year,mon]=month.split('-').map(Number);
  const next=mon===12?`${year+1}-01`:`${year}-${String(mon+1).padStart(2,'0')}`;
  // Türkiye yerel ay sınırları (+03:00). Arşivleme tarihinden bağımsızdır.
  const start=`${month}-01T00:00:00+03:00`;
  const finish=`${next}-01T00:00:00+03:00`;
  const button=document.querySelector('#backupExcel');
  if(button){button.disabled=true;button.textContent='Yedek hazırlanıyor...';}
  try{
    const records=[];
    const pageSize=500;
    for(let offset=0;;offset+=pageSize){
      const {data,error}=await sb.from('production_history').select('id,created_at,order_code,litre,pressure_bar,product_type,bombe_model,process_name,action_type,old_quantity,new_quantity,quantity_change').gte('created_at',start).lt('created_at',finish).order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+pageSize-1);
      if(error)throw error;
      records.push(...(data||[]));
      if(!data||data.length<pageSize)break;
    }
    if(!records.length){toast('Seçilen ayda yedeklenecek işlem bulunamadı.');return;}
    await cbsLoadXLSX();
    const headers=['İşlem Tarihi / Saati','Sipariş Kodu','Litre (LT)','Basınç (BAR)','Ürün Tipi','Bombe Modeli','Proses','İşlem Türü','Önceki Adet','Yeni Adet','Adet Değişimi','Kayıt ID'];
    const rows=[headers,...records.map(h=>[
      new Date(h.created_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}),
      h.order_code||'',h.litre??'',h.pressure_bar??'',h.product_type||'',h.bombe_model||'',h.process_name||'',h.action_type||'',
      h.old_quantity??'',h.new_quantity??'',h.quantity_change??'',h.id
    ])];
    const ws=window.XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:23},{wch:18},{wch:13},{wch:16},{wch:16},{wch:18},{wch:24},{wch:28},{wch:16},{wch:14},{wch:18},{wch:14}];
    ws['!autofilter']={ref:`A1:J${rows.length}`};
    const wb=window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb,ws,'İşlem Geçmişi');
    window.XLSX.writeFile(wb,`CBS_Islem_Gecmisi_${month}.xlsx`);
    toast(`${month} için ${records.length} işlem Excel'e aktarıldı.`);
  }finally{if(button){button.disabled=false;button.textContent="Excel'e Yedekle";}}
}

function cbsFillEditProduct(){
 const f=document.querySelector('#editProductForm');if(!f)return;
 const b=batch(Number(f.elements.batch_id.value));if(!b)return;
 f.elements.product_type.value=b.product_type||'TUP';
 if(b.litre!=null)f.elements.litre.value=String(b.litre);
 if(b.pressure_bar!=null)f.elements.pressure_bar.value=String(b.pressure_bar);
 f.elements.diameter_mm.value=b.diameter_mm==null?'':String(b.diameter_mm);
 if(b.litre_variant)f.elements.litre_variant.value=b.litre_variant;
 if(b.bombe_model)f.elements.bombe_model.value=b.bombe_model;
 cbsToggleEditProduct();
}
function cbsToggleEditProduct(){
 const f=document.querySelector('#editProductForm');if(!f)return;
 const bombe=f.elements.product_type.value==='BOMBE',litre=Number(f.elements.litre.value);
 f.querySelectorAll('[data-edit-tup]').forEach(el=>el.hidden=bombe);
 f.querySelectorAll('[data-edit-bombe]').forEach(el=>el.hidden=!bombe);
 f.querySelectorAll('[data-edit-120]').forEach(el=>el.hidden=bombe||litre!==120);
 f.querySelectorAll('[data-edit-1000]').forEach(el=>el.hidden=bombe||litre!==1000);
}
document.addEventListener('change',e=>{
 if(e.target.id==='editProductBatch')cbsFillEditProduct();
 if(e.target.id==='editProductType'||e.target.closest('#editProductForm')?.elements.litre===e.target)cbsToggleEditProduct();
});
let cbsEditProductBusy=false;
async function cbsSaveEditProduct(f){
 if(cbsEditProductBusy)return;
 const status=f.querySelector('#editProductStatus'),button=f.querySelector('button[type="submit"]');
 const report=(message,ok=false)=>{if(status){status.textContent=message;status.style.color=ok?'#087e59':'#b42318';}else toast(message);};
 if(!writable()){report('Bu işlem için yetkiniz yok.');return;}
 const fd=new FormData(f),b=batch(Number(fd.get('batch_id')));
 if(!b||!isActiveOrder(b.order_id)){report('Geçerli bir üretim grubu seçin.');return;}
 const type=String(fd.get('product_type'));
 if(!['TUP','TANK','BOMBE'].includes(type)){report('Ürün tipi geçersiz.');return;}
 const litre=Number(fd.get('litre')),pressure=Number(fd.get('pressure_bar'));
 if(type==='TANK'&&litre!==1000){report('Tank için 1000 LT seçilmelidir.');return;}
 if(type!=='BOMBE'&&(!LITRES.includes(litre)||![11,25,42].includes(pressure))){report('Litre ve basınç bilgilerini kontrol edin.');return;}
 const diameter=litre===120?Number(fd.get('diameter_mm')):null;
 if(type!=='BOMBE'&&litre===120&&![323,355,406].includes(diameter)){report('120 LT için çap seçin.');return;}
 const variant=litre===1000?String(fd.get('litre_variant')):null;
 if(type!=='BOMBE'&&litre===1000&&!VARIANTS.some(x=>x[0]===variant)){report('1000 LT için ürün türünü seçin.');return;}
 const model=String(fd.get('bombe_model'));
 if(type==='BOMBE'&&!BOMBE_MODELS.includes(model)){report('Bombe modelini seçin.');return;}
 const update=type==='BOMBE'?{product_type:'BOMBE',litre:null,pressure_bar:null,diameter_mm:null,litre_variant:null,bombe_model:model}:{product_type:type,litre,pressure_bar:pressure,diameter_mm:diameter,litre_variant:variant,bombe_model:null};
 if(state.batches.some(x=>x.id!==b.id&&x.order_id===b.order_id&&x.product_type===update.product_type&&x.litre===update.litre&&Number(x.pressure_bar||0)===Number(update.pressure_bar||0)&&(x.diameter_mm??null)===(update.diameter_mm??null)&&(x.litre_variant??null)===(update.litre_variant??null)&&(x.bombe_model??null)===(update.bombe_model??null))){report('Aynı siparişte bu özelliklere sahip başka bir üretim grubu var.');return;}
 if(!await cbsConfirm(`${batchLabel(b)}\n\nYeni ürün: ${type==='BOMBE'?'BOMBE / '+model:type+' / '+litre+' LT / '+pressure+' BAR'+(variant?' / '+(VARIANTS.find(x=>x[0]===variant)?.[1]||variant):'')}\n\nMevcut proses kayıtları ve plan adedi korunacak. Onaylıyor musunuz?`))return;
 cbsEditProductBusy=true;if(button)button.disabled=true;report('Kaydediliyor...',true);
 try{
  const {data,error}=await sb.from('batches').update(update).eq('id',b.id).select('*').single();
  if(error)throw error;if(!data||data.product_type!==type)throw Error('Veritabanı güncellemeyi onaylamadı.');
  try{await logHistory({b:data,action:'Ürün bilgileri değiştirildi ('+detailFor(b)+')'});}catch(e){console.warn('Ürün değişti ancak geçmiş kaydedilemedi:',e);}
  await refresh();toast('Ürün bilgileri güncellendi: '+batchLabel(data));
 }catch(e){report('Güncelleme başarısız: '+(e.message||String(e)));}
 finally{cbsEditProductBusy=false;if(button?.isConnected)button.disabled=false;}
}
// Formun tarayıcı tarafından GET olarak gönderilmesini engelle.
document.addEventListener('submit',e=>{if(e.target?.id!=='editProductForm')return;e.preventDefault();e.stopImmediatePropagation();cbsSaveEditProduct(e.target);},true);
document.addEventListener('click',e=>{const btn=e.target.closest?.('#editProductForm button[type="submit"]');if(!btn)return;e.preventDefault();e.stopImmediatePropagation();cbsSaveEditProduct(btn.closest('form'));},true);

// CBS sipariş kodu güncelleme: Kaydet tıklamasını formun varsayılan GET
// gönderimine dönüşmeden yakala. Submit olayı da klavyeyle kullanım için desteklenir.
let cbsRenameBusy=false;
async function cbsRenameSave(form){
  if(cbsRenameBusy)return;
  const status=form.querySelector('#renameStatus');
  const button=form.querySelector('button[type="submit"]');
  const show=(message,success=false)=>{
    const el=document.querySelector('#renameStatus')||status;
    if(el){el.textContent=message;el.style.color=success?'#087e59':'#b42318';}
    else toast(message);
  };
  if(!writable()){show('Sipariş kodu düzenleme yetkiniz yok.');return;}
  const fd=new FormData(form),id=Number(fd.get('id'));
  const newCode=String(fd.get('code')||'').trim().toLocaleUpperCase('tr-TR');
  const oldOrder=order(id);
  if(!oldOrder){show('Lütfen bir sipariş seçin.');return;}
  if(!newCode||newCode.length>40){show('Yeni kod 1–40 karakter olmalıdır.');return;}
  if(oldOrder.code===newCode){show('Yeni kod mevcut kodla aynı.');return;}
  if(state.orders.some(o=>o.id!==id&&o.code===newCode)){show('Bu sipariş kodu zaten kayıtlı.');return;}
  cbsRenameBusy=true;
  if(button){button.disabled=true;button.textContent='Kaydediliyor...';}
  show('Sipariş kodu güncelleniyor...',true);
  try{
    const {data,error}=await sb.from('orders').update({code:newCode}).eq('id',id).select('id,code').maybeSingle();
    if(error)throw error;
    if(!data||data.code!==newCode)throw Error('Veritabanı güncellemeyi onaylamadı. orders UPDATE yetkisini kontrol edin.');
    try{await logHistory({code:newCode,action:`Sipariş kodu değiştirildi (${oldOrder.code})`});}
    catch(historyError){console.warn('Kod değişti ancak işlem geçmişi kaydedilemedi:',historyError);}
    try{await refresh();}
    catch(refreshError){console.warn('Kod değişti ancak ekran yenilenemedi:',refreshError);}
    show(`Başarılı: ${oldOrder.code} → ${newCode}`,true);
    toast(`Sipariş kodu değiştirildi: ${oldOrder.code} → ${newCode}`);
  }catch(error){
    console.error('CBS sipariş kodu güncelleme:',error);
    show('Güncelleme başarısız: '+(error.message||String(error)));
  }finally{
    cbsRenameBusy=false;
    if(button&&button.isConnected){button.disabled=false;button.textContent='Kaydet';}
  }
}
// Tıklama yolu: native form gönderimini kesin olarak engeller.
document.addEventListener('click',function(e){
  const button=e.target.closest?.('#renameForm button[type="submit"]');
  if(!button)return;
  e.preventDefault();e.stopImmediatePropagation();
  cbsRenameSave(button.closest('form'));
},true);
// Enter ile gönderme yolu.
document.addEventListener('submit',function(e){
  if(e.target?.id!=='renameForm')return;
  e.preventDefault();e.stopImmediatePropagation();
  cbsRenameSave(e.target);
},true);

document.addEventListener('submit',async e=>{const form=e.target;if(form.id==='setupForm'){e.preventDefault();const url=$('#supabaseUrl').value.trim(),key=$('#supabaseKey').value.trim();if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)){err(Error('Supabase proje URL adresini kontrol edin.'));return}localStorage.setItem('cbs_url',url.replace(/\/$/,''));localStorage.setItem('cbs_key',key);location.reload();return}if(form.id==='loginForm'){e.preventDefault();$('#loginError').textContent='';try{const result=await sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});const d=check(result);await enter(d.session)}catch(ex){$('#loginError').textContent=ex.message}return}if(['orderForm','quickOrder','renameForm','batchForm'].includes(form.id)&&!writable()){e.preventDefault();err(Error('Bu işlem için yetkiniz yok.'));return;}if(form.id==='stockForm'){e.preventDefault();if(!writable()){err(Error('Bu işlem için yetkiniz yok.'));return;}const fd=new FormData(form);const itemId=Number(fd.get('item_id')),qty=Number(fd.get('quantity')),movementType=String(fd.get('movement_type'));if(!Number.isSafeInteger(itemId)||itemId<=0||!Number.isFinite(qty)||qty<=0||!['IN','OUT'].includes(movementType)){err(Error('Geçerli malzeme ve miktar seçin.'));return;}const btn=form.querySelector('button[type=submit]');if(btn)btn.disabled=true;try{check(await sb.rpc('cbs_stock_move',{p_item_id:itemId,p_movement_type:movementType,p_quantity:qty,p_note:String(fd.get('note')||'').trim()}));stockSelectedId=String(itemId);await refresh();toast('Stok hareketi kaydedildi.')}catch(ex){err(ex)}finally{if(btn)btn.disabled=false}return;}if(['orderForm','quickOrder','renameForm','batchForm','serialForm','processForm'].includes(form.id)){e.preventDefault();try{await submitForm(form)}catch(ex){err(ex)}}});
// Hesap silme ve geçici şifre yenileme yalnızca sunucu tarafında yetki kontrolünden geçer.
document.addEventListener('click', async e => {
  const button = e.target.closest('[data-delete-user]');
  if (!button) return;
  e.preventDefault();
  if (!admin()) { err(Error('Bu işlem yalnızca yöneticilere açıktır.')); return; }
  const userId = button.dataset.deleteUser || button.dataset.resetUser;
  if (userId === profile.id) { err(Error('Kendi hesabınız üzerinde bu işlemi yapamazsınız.')); return; }
  const target = state.profiles.find(p => p.id === userId);
  if (!target) { err(Error('Kullanıcı bulunamadı.')); return; }
  const deleting = !!button.dataset.deleteUser;
  const message = deleting
    ? `${target.email} hesabı kalıcı olarak silinecek. Bu kullanıcı artık giriş yapamayacak. Emin misiniz?`
    : `${target.email} için eski şifre geçersiz olacak ve yeni geçici şifre üretilecek. Devam edilsin mi?`;
  if (!await cbsConfirm(message)) return;
  button.disabled = true;
  try {
    const { data, error } = await sb.functions.invoke('cbs-invite-user', {
      body: { action: deleting ? 'delete_user' : 'reset_user_password', userId }
    });
    if (error) {
      let msg = error.message || 'İşlem başarısız.';
      if (error.context?.json) { try { const detail = await error.context.json(); msg = detail.error || msg; } catch (_) {} }
      throw Error(msg);
    }
    if (!data?.ok) throw Error(data?.error || 'İşlem başarısız.');
    if (deleting) { await refresh(); toast('Kullanıcı hesabı silindi.'); }
    else if (data.temporaryPassword) showTemporaryPassword(target.email, data.temporaryPassword);
    else throw Error('Şifre güncellendi fakat geçici şifre görüntülenemedi.');
  } catch (ex) { err(ex); }
  finally { button.disabled = false; }
});
document.addEventListener('click',async e=>{const nav=e.target.closest('[data-page]');if(nav){showPage(nav.dataset.page);return}if(e.target.closest('#newOrder')){if(page!=='orders'||!writable()){err(Error('Bu işlem için yetkiniz yok.'));return;}$('#modal').showModal();return}if(e.target.closest('#close')){$('#modal').close();return}if(e.target.closest('#reload')){sessionStorage.setItem('cbs_reload_page',page);const url=new URL(location.href);url.searchParams.set('cbs_refresh',String(Date.now()));location.replace(url.href);return}if(e.target.closest('#historyAll')){historyDate='';const input=$('#historyDate');if(input)input.value='';const rows=$('#historyRows');if(rows)rows.innerHTML=historyTable();return}if(e.target.closest('#boardPdf')){exportBoardPDF();return}if(e.target.closest('#perfLoad')){try{perfMonth=$('#perfMonth').value;await cbsLoadMonth(perfMonth)}catch(ex){err(ex)}return}if(e.target.closest('#export')){e.preventDefault();showPage('audit');return}if(e.target.closest('#backupExcel')){try{await exportHistoryExcel()}catch(ex){err(ex)}return}if(e.target.closest('#logout')){await sb.auth.signOut();loginScreen();return}const action=e.target.closest('[data-archive-order],[data-restore-order],[data-del-order],[data-del-batch],[data-del-serial]');if(action){if(!admin()){err(Error('Yalnızca yöneticiler bu işlemi yapabilir.'));return}try{const ds=action.dataset;let table,id,verb,label,body=null;if(ds.archiveOrder){table='orders';id=Number(ds.archiveOrder);verb='arşivle';label=order(id)?.code;body={archived_at:new Date().toISOString()}}else if(ds.restoreOrder){table='orders';id=Number(ds.restoreOrder);verb='geri yükle';label=order(id)?.code;body={archived_at:null}}else if(ds.delOrder){table='orders';id=Number(ds.delOrder);verb='sil';label=order(id)?.code;}else if(ds.delBatch){table='batches';id=Number(ds.delBatch);verb='sil';const b=batch(id);label=`${order(b?.order_id)?.code} / ${b?.litre} LT / ${bar(b)} BAR`;}else{table='serials';id=Number(ds.delSerial);verb='sil';label=state.serials.find(s=>s.id===id)?.serial}if(!Number.isFinite(id)||!label)throw Error('Kayıt bulunamadı.');if(!await cbsConfirm(verb==='sil'?`${label} kaydını silmek istediğinize emin misiniz? Bağlı üretim grupları, proses adetleri ve seri numaraları da silinebilir. Bu işlem geri alınamaz.`:`${label} kaydını ${verb==='arşivle'?'arşivlemek':'geri yüklemek'} istediğinize emin misiniz?`))return;let q=body?sb.from(table).update(body).eq('id',id):sb.from(table).delete().eq('id',id);check(await q.select('id').single());if(table!=='serials')await logHistory({code:table==='orders'?label:order(batch(id)?.order_id)?.code||label,action:table==='orders'?(verb==='sil'?'Sipariş silindi':verb==='arşivle'?'Sipariş arşivlendi':'Sipariş geri yüklendi'):'Üretim grubu silindi'});await refresh();toast(`İşlem başarılı: ${label}`)}catch(ex){err(ex)}return}const save=e.target.closest('[data-saveuser]');if(save&&admin()){const id=save.dataset.saveuser;if(id===profile.id)return;const role=document.querySelector(`[data-role="${id}"]`).value;const active=document.querySelector(`[data-active="${id}"]`).checked;try{check(await sb.from('profiles').update({role,active}).eq('id',id));await refresh();toast('Kullanıcı yetkisi güncellendi.')}catch(ex){err(ex)}}});
document.addEventListener('change',async e=>{if(e.target.id==='backupMonth'){backupMonth=e.target.value;return}if(e.target.id==='historyDate'){historyDate=e.target.value;$('#historyRows').innerHTML=historyTable();return}const sel=e.target.closest('[data-stage]');if(!sel)return;const s=state.serials.find(x=>x.id===Number(sel.dataset.stage));if(!s)return;try{await mutation(async()=>check(await sb.from('serials').update({stage:sel.value,updated_at:new Date().toISOString()}).eq('id',s.id)))}catch(ex){sel.value=s.stage;err(ex)}});

async function handleInvitation() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);

  const isInvite = hash.get('type') === 'recovery' || query.get('type') === 'recovery' || hash.get('type') === 'invite' ||
                   query.get('type') === 'invite' ||
                   hash.has('access_token') ||
                   query.has('token_hash');

  if (!isInvite && !cbsInviteOnArrival && !cbsRecoveryOnArrival) return false;

  const { data: { session: inviteSession } } =
    await sb.auth.getSession();

  if (!inviteSession) return false;

  showSetPassword(!!inviteSession.user?.app_metadata?.cbs_must_change_password);
  return true;
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'setPasswordForm') return;
  e.preventDefault();

  const password = document.querySelector('#newPassword').value;
  const confirm = document.querySelector('#confirmPassword').value;
  const errorBox = document.querySelector('#setPasswordError');
  errorBox.textContent = '';

  if (password !== confirm) {
    errorBox.textContent = 'Şifreler eşleşmiyor.';
    return;
  }

  try {
    const firstLogin = !!(await sb.auth.getUser()).data.user?.app_metadata?.cbs_must_change_password;
    if (firstLogin) {
      const { data, error } = await sb.functions.invoke('cbs-invite-user', { body: { action: 'complete_first_login', newPassword: password } });
      if (error || !data?.ok) throw Error(data?.error || error?.message || 'Şifre güncellenemedi.');
      await sb.auth.refreshSession();
    } else {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    }

    history.replaceState(null, '', location.pathname);
    document.querySelector('#setPassword').classList.add('hidden');
    toast('Şifreniz oluşturuldu. Hoş geldiniz!');
    await enter((await sb.auth.getSession()).data.session);
  } catch (error) {
    errorBox.textContent = error.message;
  }
});

boot();

// CBS: Giriş ekranından yalnızca davetli kullanıcılar için şifre oluşturma/yenileme.
document.addEventListener('click', function(e) {
  if (e.target.closest('#showPasswordHelp')) {
    document.querySelector('#login').classList.add('hidden');
    document.querySelector('#passwordHelp').classList.remove('hidden');
    document.querySelector('#passwordHelpEmail').value = document.querySelector('#email')?.value || '';
  }
  if (e.target.closest('#backToLogin')) {
    document.querySelector('#passwordHelp').classList.add('hidden');
    document.querySelector('#login').classList.remove('hidden');
  }
});
document.addEventListener('submit', async function(e) {
  if (e.target.id !== 'passwordHelpForm') return;
  e.preventDefault();
  const message = document.querySelector('#passwordHelpMessage');
  const email = document.querySelector('#passwordHelpEmail').value.trim();
  const button = e.target.querySelector('button[type="submit"]');
  message.textContent = '';
  button.disabled = true;
  button.textContent = 'Gönderiliyor...';
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    if (error) throw error;
    message.textContent = 'Bu adres için hesap varsa şifre oluşturma bağlantısı gönderildi. Gelen kutunu ve spam klasörünü kontrol et.';
  } catch (ex) {
    message.textContent = ex.message || 'Bağlantı gönderilemedi.';
  } finally {
    button.disabled = false;
    button.textContent = 'Şifre Bağlantısı Gönder';
  }
});

// Oturum açmış personelin şifresini değiştirme ekranı
function showAccountPassword(){
  const panel=$('#accountPasswordPanel'); if(!panel)return;
  panel.classList.remove('hidden'); $('#accountPasswordError').textContent='';
  panel.scrollIntoView({behavior:'smooth',block:'center'});
}
document.addEventListener('click',e=>{
  if(e.target.closest('#changeMyPassword')){showAccountPassword();return}
  if(e.target.closest('#cancelAccountPassword')){$('#accountPasswordPanel').classList.add('hidden');return}
});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='accountPasswordForm')return;
  e.preventDefault();
  const box=$('#accountPasswordError');box.textContent='';
  const next=$('#accountNewPassword').value, repeat=$('#accountRepeatPassword').value;
  if(next.length<6||next!==repeat){box.textContent='Yeni şifre en az 6 karakter olmalı ve tekrar ile eşleşmeli.';return}
  const button=e.target.querySelector('button[type=submit]');button.disabled=true;
  try{
    check(await sb.auth.updateUser({password:next}));
    e.target.reset();$('#accountPasswordPanel').classList.add('hidden');toast('Şifreniz değiştirildi.');
  }catch(ex){box.textContent=ex.message||'Şifre değiştirilemedi.'}
  finally{button.disabled=false}
});

// Yönetici: hatalı stok hareketini güvenli sunucu işlemiyle geri al.
document.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-delete-stock-movement]');
 if(!btn)return;
 e.preventDefault();
 if(!admin()){err(Error('Stok hareketini yalnızca yönetici silebilir.'));return;}
 const id=Number(btn.dataset.deleteStockMovement);
 const movement=state.stockMovements.find(m=>Number(m.id)===id);
 if(!movement){err(Error('Stok işlemi bulunamadı. Listeyi yenileyin.'));return;}
 const item=state.stockItems.find(i=>Number(i.id)===Number(movement.item_id));
 const action=movement.movement_type==='IN'?'girişi':'çıkışı';
 const effect=movement.movement_type==='IN'?'stoktan düşülecek':'stoğa geri eklenecek';
 if(!await cbsConfirm(`${item?.name||'Malzeme'}\n${stockNumber(movement.quantity)} ${item?.unit||''} stok ${action} silinsin mi?\n\nBu miktar ${effect}. İşlem geri alınamaz.`))return;
 btn.disabled=true;
 try{
   check(await sb.rpc('cbs_stock_delete_movement',{p_movement_id:id}));
   stockSelectedId=String(movement.item_id);
   await refresh();
   toast('Hatalı stok hareketi silindi; kalan stok düzeltildi.');
 }catch(ex){err(ex);btn.disabled=false;}
});

// Yönetici: yanlış eklenen proses girişini geri al ve geçmişten kaldır.
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-delete-process-entry]');
  if(!btn)return;
  e.preventDefault();
  if(!admin()){err(Error('Yalnızca yönetici silebilir.'));return}
  const id=Number(btn.dataset.deleteProcessEntry);
  const entry=state.history.find(h=>Number(h.id)===id);
  if(!entry){err(Error('İşlem kaydı bulunamadı.'));return}
  if(!await cbsConfirm(`${entry.order_code} / ${entry.process_name}\n${entry.quantity_change} adetlik girişi silmek istiyor musunuz?\n\nYalnızca bu prosesin adedi azalacak ve geçmiş kaydı kalıcı olarak silinecek.`))return;
  btn.disabled=true;
  try{
    check(await sb.rpc('cbs_delete_process_entry',{p_history_id:id}));
    await refresh();
    toast('Yanlış giriş silindi.');
  }catch(ex){err(ex);btn.disabled=false}
});


// CBS Bakım Modu: merkezi Supabase durumu, personel ekranı ve yönetici anahtarı.
async function cbsCheckMaintenance(){
  if(!sb||!session||cbsMaintenanceBusy)return;
  cbsMaintenanceBusy=true;
  try{
    const {data,error}=await sb.rpc('cbs_maintenance_status');
    if(error)throw error;
    const active=Boolean(data);
    const changed=active!==cbsMaintenanceActive;
    cbsMaintenanceActive=active;
    const overlay=document.querySelector('#cbsMaintenance');
    if(overlay)overlay.classList.toggle('hidden',!active||admin());
    const status=document.querySelector('#cbsMaintenanceStatus');
    if(status)status.textContent=active?'🔴 Bakım modu AÇIK':'🟢 Sistem normal çalışıyor';
    const toggle=document.querySelector('#cbsMaintenanceToggle');
    if(toggle)toggle.textContent=active?'Bakım Modunu Kapat':'Bakım Modunu Aç';
    if(changed&&!active&&session){await refresh();}
  }catch(e){console.warn('Bakım durumu okunamadı:',e);}
  finally{cbsMaintenanceBusy=false;}
}
function cbsStartMaintenancePolling(){
  cbsStopMaintenancePolling();
  cbsMaintenanceTimer=setInterval(()=>{if(session)cbsCheckMaintenance();},10000);
}
function cbsStopMaintenancePolling(){if(cbsMaintenanceTimer){clearInterval(cbsMaintenanceTimer);cbsMaintenanceTimer=null;}}
document.addEventListener('click',async e=>{
  if(e.target.closest('#cbsMaintenanceLogout')){
    try{await sb.auth.signOut();}catch(_e){}loginScreen();return;
  }
  const btn=e.target.closest('#cbsMaintenanceToggle');
  if(!btn)return;
  e.preventDefault();
  if(!admin()){err(Error('Bu işlem yalnızca yöneticiye açıktır.'));return;}
  const next=!cbsMaintenanceActive;
  const msg=next?'Bakım modu açılacak. Personelin ekranı en geç yaklaşık 10 saniye içinde bakım ekranına geçecek. Kaydedilmemiş formlar kaybolabilir. Devam edilsin mi?':'Bakım modu kapatılacak. Personel yeniden işlem yapabilecek. Devam edilsin mi?';
  if(!await cbsConfirm(msg))return;
  btn.disabled=true;
  try{
    check(await sb.rpc('cbs_set_maintenance',{p_enabled:next}));
    await cbsCheckMaintenance();
    toast(next?'Bakım modu açıldı.':'Bakım modu kapatıldı.');
  }catch(ex){err(ex)}finally{btn.disabled=false;}
});
// Arayüzde bakım ekranı görünmeden hemen önce de kayıt denemelerini durdur.
document.addEventListener('submit',e=>{
  if(cbsMaintenanceActive&&!admin()&&e.target.closest('#app')){
    e.preventDefault();e.stopImmediatePropagation();toast('Sistem bakımda. İşlem yapılamıyor.');
  }
},true);
document.addEventListener('click',e=>{
  if(cbsMaintenanceActive&&!admin()&&e.target.closest('#app')){
    e.preventDefault();e.stopImmediatePropagation();
  }
},true);

// CBS: Çevrim içi durumu - Supabase RPC, sadece yönetici kullanıcı listesini okuyabilir.
function cbsStopPresence(){if(cbsPresenceTimer){clearInterval(cbsPresenceTimer);cbsPresenceTimer=null;}}
async function cbsPresenceHeartbeat(){
  if(!sb||!session||!profile||cbsPresenceBusy)return;
  cbsPresenceBusy=true;
  try{const {error}=await sb.rpc('cbs_presence_ping');if(error)throw error;
    if(admin())await cbsLoadPresence();
  }catch(e){console.warn('Çevrim içi durumu güncellenemedi:',e)}finally{cbsPresenceBusy=false;}
}
async function cbsLoadPresence(){
  if(!admin()||!sb)return;
  const {data,error}=await sb.rpc('cbs_presence_online');if(error)throw error;
  cbsOnlineIds=new Set((data||[]).map(x=>String(x.user_id)));
  document.querySelectorAll('[data-presence-id]').forEach(el=>{
    const online=cbsOnlineIds.has(el.dataset.presenceId);
    el.classList.toggle('online',online);el.title=online?'Çevrim içi':'Çevrim dışı';
  });
}
function cbsStartPresence(){
  cbsStopPresence();cbsPresenceHeartbeat();
  cbsPresenceTimer=setInterval(cbsPresenceHeartbeat,20000);
}

// CBS: Self-service registration. Access requires separate admin approval.
document.addEventListener('click', e => {
  if (e.target.closest('#showRegister')) {
    $('#login').classList.add('hidden'); $('#register').classList.remove('hidden');
    $('#registerEmail').value=$('#email')?.value||'';
  }
  if (e.target.closest('#registerBack')) {
    $('#register').classList.add('hidden'); $('#login').classList.remove('hidden');
  }
});
document.addEventListener('submit', async e => {
  if(e.target.id!=='registerForm')return;
  e.preventDefault();
  const msg=$('#registerMessage');msg.textContent='';
  const email=$('#registerEmail').value.trim().toLowerCase();
  const password=$('#registerPassword').value,repeat=$('#registerRepeat').value;
  if(password.length<6||password!==repeat){msg.textContent='Şifreler aynı ve en az 6 karakter olmalı.';return;}
  const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
  try{
    const {error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
    if(error)throw error;
    msg.textContent='Kaydınız alındı. Yönetici onayı bekleniyor.';
    e.target.reset();
    const {data:{session:registered}}=await sb.auth.getSession();
    if(registered)cbsShowPending(registered);else msg.textContent='Kaydınız alındı. Yönetici onayı bekleniyor. Giriş yaparak durumunuzu kontrol edebilirsiniz.';
  }catch(ex){msg.textContent=ex.message||'Kayıt yapılamadı.';}
  finally{btn.disabled=false;}
});

document.addEventListener('click',async e=>{
  const approve=e.target.closest('[data-approve-user]');
  const reject=e.target.closest('[data-reject-user]');
  if(!approve&&!reject)return;
  if(!admin()){err(Error('Yalnızca yönetici işlem yapabilir.'));return;}
  const id=(approve||reject).dataset.approveUser||(approve||reject).dataset.rejectUser;
  const target=state.profiles.find(p=>p.id===id);
  if(!target||target.active){err(Error('Bekleyen kayıt bulunamadı.'));return;}
  if(approve){
    const role=document.querySelector(`[data-pending-role="${id}"]`)?.value||'viewer';
    if(!await cbsConfirm(`${target.email} hesabını ${role} yetkisiyle onaylamak istiyor musunuz?`))return;
    try{check(await sb.from('profiles').update({role,active:true}).eq('id',id));await refresh();toast('Hesap onaylandı.')}catch(ex){err(ex)}
  }else{
    if(!await cbsConfirm(`${target.email} kaydı kalıcı olarak reddedilip silinecek. Emin misiniz?`))return;
    try{
      const {data,error}=await sb.functions.invoke('cbs-invite-user',{body:{action:'delete_user',userId:id}});
      if(error||!data?.ok)throw Error(data?.error||error?.message||'Kayıt silinemedi.');
      await refresh();toast('Başvuru reddedildi ve hesap silindi.');
    }catch(ex){err(ex)}
  }
});

// Bekleme ekranından çıkış.
document.addEventListener('click',async e=>{if(!e.target.closest('#pendingLogout'))return;cbsStopPending();try{await sb.auth.signOut()}catch(_){}loginScreen();});

// Stok seçimi: Genel Bakış ve Sipariş Yönetimi aynı malzemeyi gösterir.
document.addEventListener('change',e=>{
 if(!['stockDashboardSelect','stockManageSelect'].includes(e.target.id))return;
 stockSelectedId=e.target.value;
 const dash=document.querySelector('#dashboard');if(dash){const box=dash.querySelector('.panel:has(#stockDashboardSelect)');if(box)box.outerHTML=stockDashboard();}
 const orders=document.querySelector('#orders');if(orders){const box=orders.querySelector('.panel:has(#stockManageSelect)');if(box)box.outerHTML=stockManagement();}
});

function cbsToggleProductForm(){
 const f=document.querySelector('#batchForm');if(!f)return;
 const bombe=f.elements.product_type.value==='BOMBE',litre=Number(f.elements.litre.value);
 if(f.elements.product_type.value==='TANK'&&litre!==1000)f.elements.litre.value='1000';
 const effectiveLitre=Number(f.elements.litre.value);
 const tankOption=f.elements.product_type.querySelector('option[value="TANK"]');if(tankOption)tankOption.hidden=effectiveLitre!==1000;
 if(effectiveLitre!==1000&&f.elements.product_type.value==='TANK')f.elements.product_type.value='TUP';
 f.querySelectorAll('[data-tup]').forEach(el=>{el.hidden=bombe||el.hasAttribute('data-120')&&effectiveLitre!==120||el.hasAttribute('data-1000')&&effectiveLitre!==1000;});
 f.querySelectorAll('[data-bombe]').forEach(el=>el.hidden=!bombe);
}
function cbsSyncProcess(){
 const f=document.querySelector('#processForm');if(!f)return;
 const b=batch(Number(f.elements.batch_id.value));const selected=f.elements.process_name.value;
 f.elements.process_name.innerHTML=options(stagesFor(b).map(s=>[s,s]),selected);
}
document.addEventListener('change',e=>{
 if(['productType','batchLitre'].includes(e.target.id))cbsToggleProductForm();
 if(e.target.id==='processBatch')cbsSyncProcess();
});

// Üretim hedefini yalnızca plan kaydında değiştir; proses adetlerine dokunma.
document.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-edit-plan]');if(!btn)return;
 if(!writable()){err(Error('Bu işlem için yetkiniz yok.'));return;}
 const b=batch(Number(btn.dataset.editPlan));if(!b){err(Error('Üretim planı bulunamadı.'));return;}
 const entered=prompt(`${batchLabel(b)}\nMevcut plan: ${b.target} adet\nYeni planlanan adedi girin:`,String(b.target));
 if(entered===null)return;
 const value=Number(entered.trim());
 if(!/^\d+$/.test(entered.trim())||!Number.isSafeInteger(value)||value<0){err(Error('Sıfır veya pozitif tam sayı girin.'));return;}
 if(value===Number(b.target))return;
 const maxProcess=Math.max(0,...quantities(b));
 if(maxProcess>value&&!await cbsConfirm(`Yeni plan (${value}) bazı proseslerde kayıtlı ${maxProcess} adetten düşük. Proses kayıtları değişmeyecek. Devam edilsin mi?`))return;
 else if(maxProcess<=value&&!await cbsConfirm(`${batchLabel(b)}\nPlanlanan miktar: ${b.target} → ${value}\nProses adetleri korunacak. Onaylıyor musunuz?`))return;
 btn.disabled=true;try{check(await sb.rpc('cbs_update_plan_target',{p_batch_id:b.id,p_new_target:value}));await refresh();toast('Üretim planı miktarı düzeltildi.');}catch(ex){err(ex);btn.disabled=false;}
});

// CBS yeni modüller
let cbsReadyOpen=false;
document.addEventListener('click',e=>{if(e.target.closest('#cbsReadyButton')){cbsReadyOpen=!cbsReadyOpen;const el=document.querySelector('#cbsReadyDetails');if(el){el.classList.toggle('hidden',!cbsReadyOpen);el.innerHTML=cbsReadyOpen?cbsReadyPanel():'';}}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.id==='cbsReadyButton'){e.preventDefault();e.target.click();}});
document.addEventListener('submit',async e=>{if(!['qualityForm','stockWeightForm'].includes(e.target.id))return;e.preventDefault();e.stopImmediatePropagation();if(!writable())return err(Error('Yetkiniz yok.'));const f=e.target,fd=new FormData(f),btn=f.querySelector('button[type="submit"]');if(btn)btn.disabled=true;try{if(f.id==='qualityForm'){const rec={batch_id:Number(fd.get('batch_id')),entry_type:String(fd.get('entry_type')),entry_date:String(fd.get('entry_date')),quantity:Number(fd.get('quantity')),note:String(fd.get('note')||'').trim()};if(!batch(rec.batch_id)||!['REPAIR','NDT_REJECT'].includes(rec.entry_type)||!Number.isSafeInteger(rec.quantity)||rec.quantity<=0)throw Error('Kayıt bilgilerini kontrol edin.');check(await sb.from('cbs_quality_entries').insert(rec));}else{const id=Number(fd.get('item_id')),kg=Number(fd.get('kg_per_unit'));if(!state.stockItems.some(x=>x.id===id)||!Number.isFinite(kg)||kg<=0)throw Error('Geçerli birim ağırlığı girin.');check(await sb.from('cbs_stock_items').update({kg_per_unit:kg}).eq('id',id));}await refresh();toast('Kayıt başarıyla kaydedildi.');}catch(ex){err(ex);}finally{if(btn?.isConnected)btn.disabled=false;}},true);
document.addEventListener('click',async e=>{const b=e.target.closest('[data-del-quality]');if(!b)return;if(!admin())return err(Error('Yalnızca yönetici silebilir.'));if(!await cbsConfirm('Bu kalite kaydı silinsin mi?'))return;try{check(await sb.from('cbs_quality_entries').delete().eq('id',Number(b.dataset.delQuality)));await refresh();toast('Kalite kaydı silindi.');}catch(ex){err(ex);}});

const CBS_EN={"Genel Bakış": "Overview", "Sipariş Yönetimi": "Order Management", "Proses Takibi": "Process Tracking", "Üretim Panosu": "Production Board", "Aylık Performans": "Monthly Performance", "Kullanıcı Yönetimi": "User Management", "İşlem Geçmişi": "Activity History", "Giriş Yap": "Sign In", "Kayıt Ol": "Register", "Çıkış Yap": "Sign Out", "Şifremi Değiştir": "Change Password", "Şifremi Güncelle": "Update Password", "Vazgeç": "Cancel", "Yenile": "Refresh", "Yeni Sipariş": "New Order", "Sipariş": "Order", "Ürün": "Product", "Ürün tipi": "Product Type", "Plan": "Plan", "Planlanan adet": "Planned Quantity", "Başlangıç": "Start", "Bitiş": "Finish", "Tahmini Bitiş Tarihi": "Estimated Completion Date", "TAHMİNİ BİTİŞ": "EST. COMPLETION", "İlerleme": "Progress", "Gecikebilir": "At Risk of Delay", "Proses": "Process", "Bu Aşamada Bekleyen": "Waiting at This Stage", "Bu Prosese Ulaşan (Toplam)": "Reached This Stage (Total)", "Henüz Üretime Girmeyen": "Not Yet Started", "TOPLAM": "TOTAL", "Kaydet": "Save", "Planı Kaydet": "Save Plan", "Siparişi Kaydet": "Save Order", "Sipariş Ekle": "Add Order", "Sipariş Oluştur": "Create Order", "Sipariş Kodu Düzenle": "Edit Order Code", "Ürün Bilgilerini Düzenle": "Edit Product Details", "Ürün Bilgilerini Kaydet": "Save Product Details", "Proses Adet Girişi": "Process Quantity Entry", "Proses Adedini Kaydet": "Save Process Quantity", "Proseslere Göre Aylık Adetler": "Monthly Quantities by Process", "Üretim Durumu": "Production Status", "Üretim Grubu": "Production Group", "Kayıtlı Üretim Planları": "Saved Production Plans", "Sevke Hazır Ürünler": "Ready to Ship", "Hazır Adet": "Ready Quantity", "Sipariş Kodu": "Order Code", "Malzeme": "Material", "Kalan": "Remaining", "Birim": "Unit", "Tonaj": "Tonnage", "Sac Stok Yönetimi": "Sheet Metal Stock Management", "Sac Stoğu / Malzeme Stok Durumu": "Sheet Metal / Material Stock", "KALAN STOK": "REMAINING STOCK", "Mevcut Malzemeler": "Current Materials", "Stok Girişi (+)": "Stock In (+)", "Stok Çıkışı (-)": "Stock Out (-)", "Stok İşlemini Kaydet": "Save Stock Transaction", "Birim Ağırlığını Kaydet": "Save Unit Weight", "1 stok biriminin ağırlığı (kg)": "Weight per Stock Unit (kg)", "İşlem": "Action", "Miktar": "Quantity", "Açıklama (isteğe bağlı)": "Description (optional)", "Tamir ve Kaynak Röntgen Ret Takibi": "Repair & Weld X-ray Rejection Tracking", "Tamir edilen tüp": "Repaired Cylinder", "Kaynak röntgen reddi": "Weld X-ray Rejection", "İşlem tarihi": "Entry Date", "Adet": "Quantity", "Not": "Note", "Kaydı Ekle": "Add Entry", "Toplam Tamir": "Total Repairs", "Toplam NDT Ret": "Total NDT Rejects", "Son Kayıtlar": "Recent Entries", "Tamir": "Repair", "NDT Ret": "NDT Reject", "Sil": "Delete", "Tüp": "Cylinder", "Tank": "Tank", "Bombe": "Dished End", "Basınç": "Pressure", "Basınç türü": "Pressure Type", "Litre": "Volume", "Malzeme seçin": "Select Material", "Raporu Göster": "Show Report", "Rapor ayı": "Report Month", "PDF Rapor Al": "Export PDF", "Aktif sipariş": "Active Orders", "TOPLAM SİPARİŞ": "TOTAL ORDERS", "ÜRETİM GRUBU": "PRODUCTION GROUPS", "PLANLANAN ÜRÜN": "PLANNED PRODUCTS", "SEVKİYATA HAZIR": "READY TO SHIP", "SEVK EDİLENLER": "SHIPPED", "Günlük İşlem Geçmişi": "Daily Activity History", "Tarih seçin": "Select Date", "Tüm Tarihler": "All Dates", "E-posta": "Email", "Şifre": "Password", "Şifre Tekrar": "Repeat Password", "Şifremi oluştur / Şifremi unuttum": "Set / Forgot Password", "Yönetici Onayı Bekleniyor": "Pending Administrator Approval", "Şifre Oluştur / Yenile": "Set / Reset Password", "Girişe Dön": "Back to Sign In", "Yeni Şifrenizi Oluşturun": "Create Your New Password", "Şifremi Kaydet": "Save Password", "Sipariş / Ürün": "Order / Product", "Üretim Planı (Tüp / Bombe / Tank)": "Production Plan (Cylinder / Dished End / Tank)", "Kayıt başarıyla güncellendi.": "Record updated successfully."};
let cbsLang=localStorage.getItem('cbs_lang')==='en'?'en':'tr';const cbsOriginal=new WeakMap();let cbsLangBusy=false;
function cbsTranslateDOM(){if(cbsLangBusy)return;cbsLangBusy=true;try{document.documentElement.lang=cbsLang;const root=document.body;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const parent=node.parentElement;if(!parent||['SCRIPT','STYLE','TEXTAREA','OPTION'].includes(parent.tagName)&&parent.tagName!=='OPTION')continue;const current=node.nodeValue;const original=cbsOriginal.has(node)?cbsOriginal.get(node):current;if(!cbsOriginal.has(node))cbsOriginal.set(node,original);const trimmed=original.trim();let replacement=CBS_EN[trimmed];if(!replacement&&trimmed.startsWith('⚠️ Gecikebilir'))replacement='⚠️ At Risk of Delay';if(!replacement&&trimmed.startsWith('📦 Sac Stok Yönetimi'))replacement='📦 Sheet Metal Stock Management';if(!replacement&&trimmed.startsWith('🔧 Tamir ve Kaynak Röntgen Ret Takibi'))replacement='🔧 Repair & Weld X-ray Rejection Tracking';if(!replacement&&trimmed.startsWith('🚚 Sevke Hazır Ürünler'))replacement='🚚 Ready to Ship';if(!replacement&&trimmed.startsWith('◫')&&trimmed.includes('Genel Bakış'))replacement='◫ Overview';if(!replacement&&trimmed.startsWith('▤')&&trimmed.includes('Sipariş Yönetimi'))replacement='▤ Order Management';if(!replacement&&trimmed.startsWith('⚙')&&trimmed.includes('Proses Takibi'))replacement='⚙ Process Tracking';if(!replacement&&trimmed.startsWith('▣')&&trimmed.includes('Üretim Panosu'))replacement='▣ Production Board';if(!replacement&&trimmed.startsWith('▥')&&trimmed.includes('Aylık Performans'))replacement='▥ Monthly Performance';if(!replacement&&trimmed.startsWith('♙')&&trimmed.includes('Kullanıcı Yönetimi'))replacement='♙ User Management';if(!replacement&&trimmed.startsWith('◷')&&trimmed.includes('İşlem Geçmişi'))replacement='◷ Activity History';if(replacement)node.nodeValue=cbsLang==='en'?original.replace(trimmed,replacement):original;else if(cbsLang==='tr'&&node.nodeValue!==original)node.nodeValue=original;}
for(const el of document.querySelectorAll('input[placeholder],button[title],span[title]')){for(const attr of ['placeholder','title']){const v=el.getAttribute(attr);if(!v)continue;const key='cbsOrig'+attr;if(!el.dataset[key])el.dataset[key]=v;el.setAttribute(attr,cbsLang==='en'?(CBS_EN[el.dataset[key]]||el.dataset[key]):el.dataset[key]);}}const btn=document.querySelector('#cbsLang');if(btn)btn.value=cbsLang;
}finally{cbsLangBusy=false;}}
function cbsLanguageControl(){if(document.querySelector('#cbsLang'))return;const box=document.createElement('label');box.id='cbsLangWrap';box.style.cssText='display:inline-flex;align-items:center;gap:7px;background:#ffffffed;color:#173f5c;border-radius:8px;padding:7px 9px;font-weight:800;white-space:nowrap;';box.innerHTML='<span>🌐</span><select id="cbsLang" aria-label="Language / Dil" style="border:0;background:transparent;font-weight:800;color:#173f5c"><option value="tr">🇹🇷 TR</option><option value="en">🇬🇧 EN</option></select>';document.body.appendChild(box);box.style.position='fixed';box.style.top='12px';box.style.right='12px';box.style.zIndex='9999';box.querySelector('select').value=cbsLang;box.querySelector('select').addEventListener('change',e=>{cbsLang=e.target.value;localStorage.setItem('cbs_lang',cbsLang);cbsTranslateDOM();});}
const cbsLanguageObserver=new MutationObserver(()=>{if(!cbsLangBusy){clearTimeout(window.cbsTranslateTimer);window.cbsTranslateTimer=setTimeout(cbsTranslateDOM,30);}});
cbsLanguageControl();cbsLanguageObserver.observe(document.body,{subtree:true,childList:true,characterData:false});cbsTranslateDOM();


// CBS additional bilingual coverage and printable reports (read-only).
Object.assign(CBS_EN, {"Üretim operasyonlarını tek ekrandan yönetin.": "Manage production operations from one screen.", "Toplam sipariş adedi": "Total ordered quantity", "Tüp ve bombe planı": "Cylinder and dished-end plans", "Paketlenen, henüz sevk edilmeyen tüp/tank": "Packed cylinders/tanks awaiting shipment", "SEVKİYAT prosesine ulaşan adet": "Quantity reaching dispatch", "Ürün / Model": "Product / Model", "Son Proses Adedi": "Final Process Quantity", "Henüz üretim planı bulunmuyor.": "No production plans yet.", "Üretim planı bulunmuyor.": "No production plans found.", "Sevke hazır ürün yok.": "No products ready for dispatch.", "Üretim Grubu Silme": "Delete Production Group", "Sipariş ve Üretim Grubu İşlemleri": "Order and Production Group Actions", "Arşivlenen Siparişler": "Archived Orders", "Arşivle": "Archive", "Geri Yükle": "Restore", "Arşiv Tarihi": "Archive Date", "İşlem Geçmişi": "Activity History", "İşlem türü": "Action Type", "Son 100 Stok İşlemi": "Last 100 Stock Transactions", "Giriş": "In", "Çıkış": "Out", "Birim ağırlığı girilmedi": "Unit weight not entered", "Bu tarihte kayıt bulunmuyor.": "No records for this date.", "Bu aşamada bekleyen": "Waiting at this stage", "Henüz üretime girmeyen": "Not yet started", "SON PROSES": "FINAL PROCESS", "BU AŞAMADA BEKLEYEN": "WAITING AT STAGE", "PROSES": "PROCESS", "Planlanan miktar": "Planned quantity", "İşlem / Proses": "Action / Process", "Tarih / Saat": "Date / Time", "Proses / İşlem": "Process / Action", "Kayıt türü": "Entry Type", "Sipariş / Litre": "Order / Volume", "Üretim Panosu Raporu": "Production Board Report", "Üretim Panosu · Görüntülenen aktif üretim grupları": "Production Board · Active production groups", "PDF Rapor Al": "Export PDF", "Üretimdeki Tüp ve Bombelerin Durumu": "Cylinder and Dished End Production Status", "Genel proses ilerlemesi:": "Overall process progress:", "Son prosese ulaşan:": "Reached final process:", "Bu prosese eklenecek adet": "Quantity to add to this process", "Kayıtlı üretim planları": "Saved production plans", "1000 L türü": "1000 L variant", "120 L çapı": "120 L diameter", "Bombe modeli": "Dished end model", "Üretim grubu": "Production group", "Seçili malzemenin kalan stoğu:": "Remaining stock of selected material:", "Stok bilgileri yüklenemedi:": "Could not load stock information:", "Kalan stok": "Remaining stock", "Sipariş kodu": "Order code", "Yeni kod": "New code", "Şifre Oluştur / Yenile": "Set / Reset Password", "Yetkili Personel": "Authorized Staff", "Görüntüleyici": "Viewer", "Yönetici": "Administrator", "Kayıt başarıyla kaydedildi.": "Record saved successfully.", "Güncelleniyor...": "Updating...", "Kayıt başarıyla güncellendi.": "Record updated successfully.", "Kayıt bilgilerini kontrol edin.": "Please check the entry details.", "Geçerli bir ay seçin.": "Select a valid month.", "Rapor, işlemlerin yapıldığı tarihe göre hazırlanır. Arşivleme tarihi dikkate alınmaz. Silinmiş geçmiş girişleri rapora dahil değildir.": "Reports use transaction dates, not archive dates. Deleted entries are excluded.", "Ayı seçip Raporu Göster düğmesine basın.": "Select a month and click Show Report.", "Aylık Üretim Performansı": "Monthly Production Performance", "Tüp Hacmine Göre Aylık Sevkiyat": "Monthly Dispatch by Cylinder Volume", "TOPLAM SEVKİYAT:": "TOTAL DISPATCH:", "Rapor ayı": "Report month", "Plan:": "Plan:", "adet": "pcs", "ton": "tonnes", "Stok İşlemini Kaydet": "Save Stock Transaction", "Şifre Bağlantısı Gönder": "Send Password Reset Link", "Onayla": "Approve", "Reddet": "Reject", "Hesabı Sil": "Delete Account", "Hesap Aktif": "Account Active", "Rol": "Role", "Durum": "Status", "Bekleyen Onaylar": "Pending Approvals", "Kullanıcı Yetkileri": "User Permissions", "Sistem Bakım Modu": "System Maintenance Mode", "Bakım durumunu değiştir": "Toggle Maintenance Mode", "Yedeklenecek ay": "Backup month", "Excel’e Yedekle": "Export Excel Backup", "Excel'e Yedekle": "Export Excel Backup", "PDF raporları": "PDF reports", "Gecikme Raporu": "Delay Risk Report", "Sac Stok Raporu": "Sheet Metal Stock Report", "Aylık Performans Raporu": "Monthly Performance Report", "Üretim Raporu": "Production Report", "Rapor tarihi": "Report date", "Tahmini bitiş": "Estimated completion", "İlerleme oranı": "Progress rate", "Risk durumu": "Risk status", "Risk yok": "No risk", "Gecikebilir": "At risk of delay", "Ürün Bilgilerini Düzenle": "Edit Product Details", "Kordon Çekme": "Flanging", "Kesim": "Cutting", "Pres": "Pressing", "Büküm": "Bending", "Doğrultma": "Straightening", "Gövde Kaynak": "Body Welding", "Montaj": "Assembly", "Çevre Kaynak": "Circumferential Welding", "Fittings Kaynak": "Fittings Welding", "Kulak Kulp Kaynak": "Bracket/Handle Welding", "Tank Temizlik": "Tank Cleaning", "Hidrostatik Test": "Hydrostatic Test", "Boya": "Painting", "Paketleme": "Packaging", "Sevkiyat": "Dispatch", "KESİM": "CUTTING", "PRES": "PRESSING", "KORDON": "FLANGING", "BÜKÜM": "BENDING", "DOĞRULTMA": "STRAIGHTENING", "GÖVDE KAYNAK": "BODY WELDING", "MONTAJ": "ASSEMBLY", "ÇEVRE KAYNAK": "CIRCUMFERENTIAL WELDING", "FİTTİNGS KAYNAK": "FITTINGS WELDING", "KULAK KULP KAYNAK": "BRACKET/HANDLE WELDING", "TANK TEMİZLİK": "TANK CLEANING", "HİDROSTATİK TEST": "HYDROSTATIC TEST", "BOYA": "PAINTING", "PAKETLEME": "PACKAGING", "SEVKİYAT": "DISPATCH", "KORDON ÇEKME": "FLANGING", "TÜP": "CYLINDER", "BOMBE": "DISHED END"});
const cbsOriginalTranslate=cbsTranslateDOM;
function cbsTranslateExtended(){
  cbsOriginalTranslate();
  if(cbsLang!=='en')return;
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
  const keys=Object.keys(CBS_EN).filter(k=>k.length>3).sort((a,b)=>b.length-a.length);
  while((n=w.nextNode())){
    const p=n.parentElement;if(!p||['SCRIPT','STYLE','TEXTAREA'].includes(p.tagName)||p.closest('#cbsLangWrap'))continue;
    const raw=cbsOriginal.has(n)?cbsOriginal.get(n):n.nodeValue;
    if(!cbsOriginal.has(n))cbsOriginal.set(n,raw);
    let s=raw;
    for(const k of keys){if(s.includes(k))s=s.split(k).join(CBS_EN[k]);}
    if(s!==n.nodeValue)n.nodeValue=s;
  }
}
// Keep Turkish originals and translate newly rendered screens too.
cbsTranslateDOM=cbsTranslateExtended;
function cbsPdfPrint(title,tableHtml){
 const locale=cbsLang==='en'?'en-GB':'tr-TR';
 const date=new Date().toLocaleString(locale);
 const doc=`<!doctype html><html lang="${cbsLang}"><head><meta charset="utf-8"><title>CBS - ${esc(title)}</title><style>
 @page{size:A4 landscape;margin:13mm}body{font:12px Arial,sans-serif;color:#172d3d}header{border-bottom:3px solid #174e68;padding-bottom:12px;margin-bottom:20px}h1{font-size:21px;margin:0}h2{font-size:17px;margin:8px 0 14px}p{color:#486274}table{border-collapse:collapse;width:100%;font-size:10px;margin:12px 0}th,td{border:1px solid #b6c8d4;padding:7px;text-align:left;vertical-align:top}th{background:#e5f1f6}tr{break-inside:avoid}.progress{height:8px;background:#e6eef2}.progress i{display:block;background:#187da4;height:8px}button,form,input,select{display:none!important}.panel{margin:12px 0;break-inside:avoid}.cbs-board-grid{display:block}.cbs-board-card{border:1px solid #b6c8d4;padding:10px;margin:12px 0;break-inside:avoid}.cbs-board-kpis{display:flex;gap:20px}.cbs-board-kpis>div{display:flex;gap:5px}.cbs-stage-row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:3px}footer{margin-top:20px;font-size:10px;color:#64748b}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header><h1>ÇUKUROVA BOMBE SANAYİ · CBS</h1><p>${esc(title)} · ${esc(cbsLang==='en'?'Report date':'Rapor tarihi')}: ${esc(date)}</p></header>${tableHtml}<footer>CBS ${esc(title)}</footer><script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script></body></html>`;
 const win=window.open('','_blank');if(!win){toast(cbsLang==='en'?'Allow pop-ups to print the report.':'PDF için açılır pencerelere izin verin.');return;}win.document.open();win.document.write(doc);win.document.close();
}
function cbsPdfTable(headers,rows){return `<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function cbsReport(type){
 const en=cbsLang==='en',t=s=>en?(CBS_EN[s]||s):s;
 if(type==='production'){
  const rows=activeBatches().map(b=>[order(b.order_id)?.code||'—',detailFor(b),b.target,shipped(b),progress(b)+'%',b.end_date||'—']);
  cbsPdfPrint(t('Üretim Raporu'),cbsPdfTable([t('Sipariş Kodu'),t('Ürün'),t('Plan'),t('Son Proses Adedi'),t('İlerleme'),t('Tahmini Bitiş Tarihi')],rows));
 }else if(type==='stock'){
  const rows=state.stockItems.map(i=>[i.name,stockNumber(i.quantity),i.unit,cbsTonsText(i)]);
  cbsPdfPrint(t('Sac Stok Raporu'),cbsPdfTable([t('Malzeme'),t('Kalan'),t('Birim'),t('Tonaj')],rows));
 }else if(type==='delay'){
  const rows=activeBatches().map(b=>[order(b.order_id)?.code||'—',detailFor(b),b.end_date||'—',progress(b)+'%',cbsLate(b)?t('Gecikebilir'):t('Risk yok')]);
  cbsPdfPrint(t('Gecikme Raporu'),cbsPdfTable([t('Sipariş Kodu'),t('Ürün'),t('Tahmini Bitiş Tarihi'),t('İlerleme'),t('Risk durumu')],rows));
 }else if(type==='monthly'){
  if(perfLoadedMonth!==perfMonth){toast(en?'Select a month and click Show Report first.':'Önce ay seçip Raporu Göster butonuna basın.');return;}
  const source=document.querySelector('#perfResult');if(!source)return;
  const clone=source.cloneNode(true);clone.querySelectorAll('button,input,select').forEach(x=>x.remove());
  if(en){const w=document.createTreeWalker(clone,NodeFilter.SHOW_TEXT);let n;const keys=Object.keys(CBS_EN).sort((a,b)=>b.length-a.length);while((n=w.nextNode())){let s=n.nodeValue;for(const k of keys)s=s.split(k).join(CBS_EN[k]);n.nodeValue=s;}}
  cbsPdfPrint(t('Aylık Performans Raporu')+' · '+perfMonth,clone.outerHTML);
 }
}
function cbsReportButtons(){
 const specs=[['dashboard','production','Üretim Raporu'],['dashboard','delay','Gecikme Raporu'],['orders','stock','Sac Stok Raporu'],['performance','monthly','Aylık Performans Raporu']];
 for(const [section,type,label] of specs){const target=document.getElementById(section);if(!target||target.querySelector(`[data-cbs-report="${type}"]`))continue;
  const btn=document.createElement('button');btn.type='button';btn.className='btn secondary';btn.dataset.cbsReport=type;btn.style.margin='8px 8px 12px 0';btn.textContent='📄 '+(cbsLang==='en'?(CBS_EN[label]||label):label)+' PDF';
  if(section==='orders'){const stock=[...target.querySelectorAll('.panel')].find(p=>p.querySelector('#stockManageSelect'));if(!stock)continue;stock.insertBefore(btn,stock.firstChild);}else if(section==='performance'){const toolbar=target.querySelector('.cbs-toolbar');if(!toolbar)continue;toolbar.appendChild(btn);}else target.insertBefore(btn,target.firstChild);
 }
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-cbs-report]');if(b){e.preventDefault();cbsReport(b.dataset.cbsReport);}},true);
const cbsReportObserver=new MutationObserver(()=>{clearTimeout(window.cbsReportTimer);window.cbsReportTimer=setTimeout(()=>{cbsReportButtons();cbsTranslateDOM();},75);});
cbsReportObserver.observe(document.querySelector('#app'),{subtree:true,childList:true});
cbsReportButtons();cbsTranslateDOM();
