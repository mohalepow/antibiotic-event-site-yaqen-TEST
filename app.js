
const CONFIG = window.APP_CONFIG || {};
const hasBackend = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY &&
  !CONFIG.SUPABASE_URL.includes("YOUR_") && !CONFIG.SUPABASE_ANON_KEY.includes("YOUR_"));
const supabaseClient = hasBackend && window.supabase
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

const $ = id => document.getElementById(id);
let booths = [];
let selectedId = null;
let editing = false;
let currentMapUrl = null;
let siteAccessSettings = { locked: false, message: "", unlock_at: null };
let siteAccessTimer = null;
let siteAccessRefreshTimer = null;
let siteAccessChannel = null;
let siteAccessRefreshBusy = false;
let siteAccessRefreshQueued = false;
let siteAccessRequestVersion = 0;
let siteAccessLastVerifiedAt = 0;
let siteAccessExpiryHandled = false;
const ar = n => new Intl.NumberFormat("ar-SA").format(n);
const toast = message => { $("toast").textContent=message; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),2600); };

function setMap(url) {
  currentMapUrl = url || null;
  $("floorplan").src = url || "assets/floor-plan-placeholder.svg";
  $("map-empty").classList.toggle("hidden", Boolean(url));
}

async function loadData() {
  if (!supabaseClient) {
    booths = [];
    renderAll();
    $("booth-count").textContent = "٠ بوثات";
    return;
  }
  const [{data: boothData,error: boothError},{data: settingData,error: settingError}] = await Promise.all([
    supabaseClient.from("booths").select("*").order("booth_number"),
    supabaseClient.from("site_settings").select("value").eq("key","map_url").maybeSingle()
  ]);
  if (boothError) { console.error(boothError); toast("تعذر تحميل البوثات. راجع إعداد قاعدة البيانات."); }
  if (settingError) console.warn("Map setting could not be loaded:", settingError);
  booths = boothData || [];
  setMap(settingData?.value || null);
  renderAll();
  window.dispatchEvent(new CustomEvent("event-booths-loaded"));
}

function renderAll() {
  $("booth-count").textContent = `${ar(booths.length)} بوثات`;
  renderPins(); renderBoothCards();
  if (selectedId && booths.some(b=>b.id===selectedId)) selectBooth(selectedId);
  else clearDetails();
  if (!$("admin-view").classList.contains("hidden")) renderAdminBooths();
}
function clearDetails() {
  $("details-empty").classList.remove("hidden");
  $("details-content").classList.add("hidden");
}
function selectBooth(id) {
  const b = booths.find(item=>item.id===id); if(!b) return;
  selectedId=id;
  $("details-empty").classList.add("hidden"); $("details-content").classList.remove("hidden");
  $("detail-number").textContent=`البوث ${ar(b.booth_number)}`;
  $("detail-category").textContent=b.category || "ركن توعوي";
  $("detail-icon").textContent=b.icon || "✚";
  $("detail-title").textContent=b.name;
  $("detail-description").textContent=b.description || "";
  $("detail-location").textContent=b.location || "يُحدد لاحقًا";
  document.querySelectorAll(".pin").forEach(p=>p.classList.toggle("active",Number(p.dataset.id)===id));
}
function renderPins() {
  $("map-pins").innerHTML="";
  booths.forEach(b=>{
    const pin=document.createElement("button"); pin.className="pin"; pin.type="button";
    pin.style.left=`${b.x}%`; pin.style.top=`${b.y}%`; pin.dataset.id=b.id;
    pin.setAttribute("aria-label",`عرض ${b.name}`);
    const span=document.createElement("span"); span.textContent=ar(b.booth_number); pin.append(span);
    pin.addEventListener("click",()=>selectBooth(b.id)); $("map-pins").append(pin);
  });
}
function renderBoothCards(query="") {
  const list=$("booth-list"); list.innerHTML="";
  const filtered=booths.filter(b=>`${b.name} ${b.category||""} ${b.location||""}`.toLowerCase().includes(query.trim().toLowerCase()));
  filtered.forEach(b=>{
    const card=document.createElement("button"); card.className="booth-card"; card.type="button";
    const head=document.createElement("div"); head.className="card-head";
    const no=document.createElement("span"); no.className="card-no"; no.textContent=`البوث ${ar(b.booth_number)}`;
    const icon=document.createElement("span"); icon.className="card-icon"; icon.textContent=b.icon||"✚"; head.append(no,icon);
    const title=document.createElement("h3"); title.textContent=b.name;
    const desc=document.createElement("p"); desc.textContent=b.description||"تفاصيل هذا البوث ستضاف قريبًا.";
    const loc=document.createElement("div"); loc.className="card-location"; loc.textContent=`⌖ ${b.location||"الموقع غير محدد"}`;
    card.append(head,title,desc,loc); card.addEventListener("click",()=>{selectBooth(b.id);$("map").scrollIntoView({behavior:"smooth"});}); list.append(card);
  });
  $("no-results").classList.toggle("hidden",filtered.length!==0);
}
$("search").addEventListener("input",e=>renderBoothCards(e.target.value));

function openModal(){ $("admin-modal").classList.remove("hidden"); }
function closeModal(){ $("admin-modal").classList.add("hidden"); }
$("admin-open").addEventListener("click",openModal); $("admin-close").addEventListener("click",closeModal);
$("admin-modal").addEventListener("click",e=>{if(e.target===$("admin-modal"))closeModal();});

let adminDashboardChannel = null;
let adminDashboardTimer = null;
let adminDashboardBusy = false;

function setDashboardNumber(id, value) {
  const node = $(id);
  if (node) node.textContent = ar(Number(value || 0));
}

function renderAdminVisitChart(rows = []) {
  const root = $("admin-visits-chart");
  if (!root) return;
  root.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = "لا توجد زيارات مسجلة خلال هذه الفترة.";
    root.append(empty);
    return;
  }
  const max = Math.max(1, ...rows.map(row => Number(row.visits || 0)));
  rows.forEach(row => {
    const line = document.createElement("div");
    line.className = "visit-bar-row";
    const date = new Date(`${row.date}T12:00:00+03:00`);
    const day = document.createElement("span");
    day.className = "visit-day";
    day.textContent = new Intl.DateTimeFormat("ar-SA", { weekday: "short" }).format(date);
    const track = document.createElement("span");
    track.className = "visit-bar-track";
    const bar = document.createElement("span");
    bar.className = "visit-bar";
    const amount = Number(row.visits || 0);
    bar.style.width = `${amount ? Math.max(3, amount / max * 100) : 0}%`;
    track.append(bar);
    const count = document.createElement("b");
    count.className = "visit-count";
    count.textContent = ar(amount);
    line.append(day, track, count);
    root.append(line);
  });
}

function renderAdminPlayers(rootId, players = [], mode = "top") {
  const root = $(rootId);
  if (!root) return;
  root.replaceChildren();
  if (!players.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = "لا توجد بيانات مسجلة حتى الآن.";
    root.append(empty);
    return;
  }
  players.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "admin-live-row";
    const rank = document.createElement("span");
    rank.className = mode === "top" ? "admin-live-rank" : "admin-live-date";
    if (mode === "top") {
      rank.textContent = ar(index + 1);
    } else {
      const date = player.updated_at ? new Date(player.updated_at) : null;
      rank.textContent = date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(date)
        : "حديثًا";
    }
    const info = document.createElement("div");
    info.className = "admin-live-info";
    const name = document.createElement("b");
    name.textContent = player.display_name || "مشارك";
    const details = document.createElement("small");
    details.textContent = `اللعبة ${ar(player.game_points)} · الاختبار ${ar(player.quiz_points)}`;
    info.append(name, details);
    const points = document.createElement("strong");
    points.textContent = `${ar(player.total_score)} نقطة`;
    row.append(rank, info, points);
    root.append(row);
  });
}

async function loadAdminDashboard() {
  if (!supabaseClient || $("admin-view").classList.contains("hidden") || adminDashboardBusy) return;
  adminDashboardBusy = true;
  $("dashboard-error").classList.add("hidden");
  try {
    const { data, error } = await supabaseClient.rpc("get_admin_dashboard");
    if (error) throw error;
    const stats = data || {};
    setDashboardNumber("admin-visits-today", stats.visits_today);
    setDashboardNumber("admin-visits-total", stats.visits_total);
    setDashboardNumber("admin-participants", stats.participants);
    setDashboardNumber("admin-points", stats.total_points);
    setDashboardNumber("admin-games", stats.game_attempts);
    setDashboardNumber("admin-quizzes", stats.quizzes_completed);
    setDashboardNumber("admin-badges", stats.badges_earned);
    setDashboardNumber("admin-booths-count", stats.booths);
    renderAdminVisitChart(Array.isArray(stats.visits_week) ? stats.visits_week : []);
    renderAdminPlayers("admin-top-players", Array.isArray(stats.top_players) ? stats.top_players : [], "top");
    renderAdminPlayers("admin-recent-players", Array.isArray(stats.recent_players) ? stats.recent_players : [], "recent");
    $("dashboard-updated").textContent = `آخر تحديث: ${new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`;
  } catch (error) {
    console.error("Admin dashboard:", error);
    $("dashboard-error").textContent = "تعذر تحميل الإحصائيات. تأكد من تشغيل ملف supabase-unified-setup.sql ومن دخولك بحساب مدير مضاف إلى event_admins.";
    $("dashboard-error").classList.remove("hidden");
    $("admin-live-state").innerHTML = "<i></i> يحتاج إلى إعداد";
  } finally {
    adminDashboardBusy = false;
  }
}

function stopAdminLiveUpdates() {
  if (adminDashboardTimer) clearInterval(adminDashboardTimer);
  adminDashboardTimer = null;
  if (adminDashboardChannel && supabaseClient) supabaseClient.removeChannel(adminDashboardChannel);
  adminDashboardChannel = null;
}

function startAdminLiveUpdates() {
  if (!supabaseClient) return;
  stopAdminLiveUpdates();
  loadAdminDashboard();
  adminDashboardTimer = setInterval(loadAdminDashboard, 30000);
  adminDashboardChannel = supabaseClient.channel("admin-dashboard-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "event_leaderboard" }, loadAdminDashboard)
    .on("postgres_changes", { event: "*", schema: "public", table: "player_achievements" }, loadAdminDashboard)
    .on("postgres_changes", { event: "*", schema: "public", table: "event_visits" }, loadAdminDashboard)
    .on("postgres_changes", { event: "*", schema: "public", table: "booths" }, loadAdminDashboard)
    .subscribe(status => {
      const node = $("admin-live-state");
      if (!node) return;
      node.innerHTML = status === "SUBSCRIBED" ? "<i></i> متصل بالتحديث الفوري" : "<i></i> تحديث تلقائي كل ٣٠ ثانية";
    });
}

$("refresh-dashboard")?.addEventListener("click", loadAdminDashboard);

function normalizeSiteAccess(value){
  if(!value || typeof value !== "object") return {locked:false,message:"",unlock_at:null,updated_at:null};
  const unlockAt=value.unlock_at && Number.isFinite(new Date(value.unlock_at).getTime()) ? new Date(value.unlock_at).toISOString() : null;
  return {
    locked:value.locked === true,
    message:typeof value.message === "string" ? value.message.slice(0,500) : "",
    unlock_at:unlockAt,
    updated_at:typeof value.updated_at === "string" ? value.updated_at : null
  };
}

function setAccessConnectionState(state){
  const nodes=[$("site-lock-connection"),$("site-lock-admin-connection")].filter(Boolean);
  if(!nodes.length)return;
  const labels={
    SUBSCRIBED:"متصل بالتحديث الفوري",
    CONNECTING:"جارٍ الاتصال بالخادم…",
    CHANNEL_ERROR:"الاتصال غير مستقر · التحقق الاحتياطي يعمل",
    TIMED_OUT:"الاتصال متأخر · التحقق الاحتياطي يعمل",
    CLOSED:"الاتصال متوقف · إعادة المحاولة جارية"
  };
  nodes.forEach(node=>{
    node.textContent=labels[state]||labels.CONNECTING;
    node.dataset.state=state;
  });
}

function applySiteAccess(){
  const lock=$("site-lock-screen");
  if(!lock)return;
  siteAccessSettings=normalizeSiteAccess(siteAccessSettings);
  let locked=siteAccessSettings.locked;
  let remaining=null;
  if(locked && siteAccessSettings.unlock_at){
    remaining=new Date(siteAccessSettings.unlock_at).getTime()-Date.now();
    if(Number.isFinite(remaining) && remaining<=0){
      locked=false;
    }
  }
  const countdown=$("site-lock-countdown");
  if(locked && remaining!==null){
    const totalSeconds=Math.max(0,Math.floor(remaining/1000));
    const days=Math.floor(totalSeconds/86400);
    const hours=Math.floor((totalSeconds%86400)/3600);
    const minutes=Math.floor((totalSeconds%3600)/60);
    const seconds=totalSeconds%60;
    countdown.textContent=days
      ? `يفتح الموقع خلال ${ar(days)} يوم · ${ar(hours).padStart(2,"0")}:${ar(minutes).padStart(2,"0")}:${ar(seconds).padStart(2,"0")}`
      : `يفتح الموقع خلال ${ar(hours).padStart(2,"0")}:${ar(minutes).padStart(2,"0")}:${ar(seconds).padStart(2,"0")}`;
    countdown.classList.remove("hidden");
  }else countdown.classList.add("hidden");

  $("site-lock-title").textContent=locked?"الموقع متوقف مؤقتًا":"مرحبًا بكم في فعالية مِضادّ";
  $("site-lock-message").textContent=siteAccessSettings.message||"سيتم فتح الموقع قريبًا. ترقّبونا!";
  document.body.classList.remove("site-access-pending");
  document.body.classList.toggle("site-is-locked",locked);
  lock.classList.toggle("hidden",!locked);

  for(const child of document.body.children){
    if(child===lock || child.id==="admin-modal" || child.tagName==="SCRIPT")continue;
    child.inert=locked;
    if(locked)child.setAttribute("aria-hidden","true");
    else child.removeAttribute("aria-hidden");
  }
  document.documentElement.style.overflow=locked?"hidden":"";
  document.body.style.overflow=locked?"hidden":"";
  document.documentElement.style.overscrollBehavior=locked?"none":"";
  document.body.style.overscrollBehavior=locked?"none":"";
  const adminModal=$("admin-modal");
  if(adminModal)adminModal.style.zIndex=locked?"2147483002":"";

  if(siteAccessTimer)clearTimeout(siteAccessTimer);
  if(locked && siteAccessSettings.unlock_at){
    siteAccessTimer=setTimeout(()=>{
      applySiteAccess();
      refreshSiteAccess();
    },Math.max(250,remaining+50));
  }
}

async function refreshSiteAccess(){
  if(!supabaseClient)return false;
  if(siteAccessRefreshBusy){siteAccessRefreshQueued=true;return false;}
  siteAccessRefreshBusy=true;
  const requestVersion=++siteAccessRequestVersion;
  let succeeded=false;
  try{
    const {data,error}=await supabaseClient.from("site_settings").select("value").eq("key","event_access").maybeSingle();
    if(error)throw error;
    if(requestVersion!==siteAccessRequestVersion)return false;
    siteAccessSettings=normalizeSiteAccess(data?.value);
    siteAccessLastVerifiedAt=Date.now();
    siteAccessExpiryHandled=false;
    applySiteAccess();
    succeeded=true;
  }catch(error){
    console.error("Site access verification failed:",error);
    setAccessConnectionState("CHANNEL_ERROR");
    if(!siteAccessLastVerifiedAt || Date.now()-siteAccessLastVerifiedAt>12000){
      document.body.classList.add("site-access-pending","site-is-locked");
      $("site-lock-screen")?.classList.remove("hidden");
      $("site-lock-title").textContent="تعذر التحقق من إتاحة الموقع";
      $("site-lock-message").textContent="الموقع مغلق مؤقتًا حتى نتمكن من التحقق من حالة الإتاحة. تحقق من الاتصال ثم أعد المحاولة.";
    }
  }finally{
    siteAccessRefreshBusy=false;
    if(siteAccessRefreshQueued){
      siteAccessRefreshQueued=false;
      queueMicrotask(()=>refreshSiteAccess());
    }
  }
  return succeeded;
}

function startSiteAccessRealtime(){
  if(!supabaseClient)return;
  if(siteAccessChannel)supabaseClient.removeChannel(siteAccessChannel);
  setAccessConnectionState("CONNECTING");
  siteAccessChannel=supabaseClient.channel("site-access-control-live-v2")
    .on("postgres_changes",{event:"*",schema:"public",table:"site_settings",filter:"key=eq.event_access"},payload=>{
      const next=payload.eventType==="DELETE"?normalizeSiteAccess(null):normalizeSiteAccess(payload.new?.value);
      siteAccessRequestVersion++;
      siteAccessSettings=next;
      siteAccessLastVerifiedAt=Date.now();
      applySiteAccess();
      const adminMessage=$("site-lock-admin-status");
      if(adminMessage && !$("admin-view").classList.contains("hidden")){
        $("site-lock-message-input").value=next.message;
        $("site-lock-unlock-at").value=next.unlock_at?new Date(new Date(next.unlock_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):"";
      }
    })
    .subscribe(status=>{
      setAccessConnectionState(status);
      if(status==="SUBSCRIBED")refreshSiteAccess();
      else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED")refreshSiteAccess();
    });
}

async function saveSiteAccess(locked){
  const status=$("site-lock-admin-status");
  const enableButton=$("site-lock-enable"),disableButton=$("site-lock-disable");
  if(!supabaseClient){status.textContent="تعذر الاتصال بقاعدة البيانات. تحقق من إعدادات Supabase.";return;}
  const {data:sessionData,error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError||!sessionData?.session){status.textContent="انتهت جلسة الإدارة. سجّل الدخول مجددًا ثم حاول.";return;}
  const message=$("site-lock-message-input").value.trim();
  const rawUnlock=$("site-lock-unlock-at").value;
  let unlockAt=null;
  if(locked && rawUnlock){
    const parsed=new Date(rawUnlock);
    if(!Number.isFinite(parsed.getTime())){status.textContent="وقت الفتح غير صالح.";return;}
    unlockAt=parsed.toISOString();
  }
  if(locked && !message){status.textContent="اكتب الرسالة التي ستظهر للزوار أولًا.";$("site-lock-message-input").focus();return;}
  if(locked && unlockAt && new Date(unlockAt).getTime()<=Date.now()){status.textContent="اختر وقتًا مستقبليًا لفتح الموقع.";return;}
  enableButton.disabled=true;disableButton.disabled=true;status.textContent="جارٍ حفظ الحالة والتحقق من وصولها إلى الخادم…";
  const value={locked:Boolean(locked),message:message||"سيتم فتح الموقع قريبًا. ترقّبونا!",unlock_at:unlockAt,updated_at:new Date().toISOString()};
  try{
    const {error:writeError}=await supabaseClient
      .from("site_settings")
      .upsert({key:"event_access",value},{onConflict:"key"});
    if(writeError)throw writeError;
    const {data:verifyRow,error:verifyError}=await supabaseClient
      .from("site_settings")
      .select("key,value")
      .eq("key","event_access")
      .maybeSingle();
    if(verifyError)throw verifyError;
    if(!verifyRow || verifyRow.key!=="event_access"){
      throw new Error("نجح طلب الكتابة لكن لم يُعثر على سجل event_access عند إعادة القراءة. تحقق من المشروع والجدول وسياسات SELECT.");
    }

    let savedValue=verifyRow.value;
    if(typeof savedValue==="string"){
      try{savedValue=JSON.parse(savedValue);}catch{throw new Error("قيمة event_access المخزنة ليست JSON صالحًا.");}
    }
    if(!savedValue || typeof savedValue!=="object"){
      throw new Error("سجل event_access موجود لكن محتوى value غير صالح.");
    }
    const savedUnlock=savedValue.unlock_at?new Date(savedValue.unlock_at).getTime():null;
    const expectedUnlock=unlockAt?new Date(unlockAt).getTime():null;
    const matches=Boolean(savedValue.locked)===value.locked
      && String(savedValue.message??"")===value.message
      && savedUnlock===expectedUnlock;
    if(!matches){
      console.error("Site access read-back mismatch:",{expected:value,actual:savedValue,key:verifyRow.key});
      throw new Error("تمت الكتابة لكن القيم المقروءة لا تطابق الإعدادات المطلوبة. قد توجد عملية أخرى تعدّل الإعداد بالتزامن.");
    }

    siteAccessRequestVersion++;
    siteAccessSettings=normalizeSiteAccess(savedValue);
    siteAccessLastVerifiedAt=Date.now();
    applySiteAccess();
    status.textContent=locked?"تم إيقاف دخول الزوار والتحقق من حفظ الحالة بنجاح. ستصل التغييرات للأجهزة المتصلة فورًا.":"تم فتح الموقع والتحقق من حفظ الحالة بنجاح. ستصل التغييرات للأجهزة المتصلة فورًا.";
    toast(locked?"تم إيقاف الموقع":"تم فتح الموقع");
    refreshSiteAccess();
  }catch(error){
    console.error("Could not save site access:",error);
    const detail=String(error?.message||error?.details||error?.hint||"خطأ غير معروف");
    const code=error?.code?` [${error.code}]`:"";
    console.error("Supabase site access save diagnostics:",{code:error?.code,message:error?.message,details:error?.details,hint:error?.hint,status:error?.status});
    status.textContent=`فشل الحفظ${code}: ${detail}`;
  }finally{
    enableButton.disabled=false;disableButton.disabled=false;
  }
}

$("site-lock-enable")?.addEventListener("click",()=>saveSiteAccess(true));
$("site-lock-disable")?.addEventListener("click",()=>saveSiteAccess(false));
$("site-lock-admin")?.addEventListener("click",openModal);
function isAllowedDuringLock(target){
  const lock=$("site-lock-screen"),admin=$("admin-modal");
  return Boolean((lock&&lock.contains(target))||(admin&&!admin.classList.contains("hidden")&&admin.contains(target)));
}
function blockLockedInteraction(event){
  if(!document.body.classList.contains("site-is-locked")&&!document.body.classList.contains("site-access-pending"))return;
  if(isAllowedDuringLock(event.target))return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
}
["click","dblclick","auxclick","pointerdown","pointerup","mousedown","mouseup","touchstart","touchend","touchmove","submit","change","input","beforeinput","keydown","keyup","contextmenu","dragstart","dragover","drop","wheel"].forEach(type=>document.addEventListener(type,blockLockedInteraction,{capture:true,passive:false}));
document.addEventListener("focusin",event=>{
  if((document.body.classList.contains("site-is-locked")||document.body.classList.contains("site-access-pending"))&&!isAllowedDuringLock(event.target)){
    event.stopPropagation();
    const target=$("site-lock-admin");
    if(target && document.activeElement!==target)target.focus({preventScroll:true});
  }
},true);
document.addEventListener("keydown",event=>{
  if(event.key!=="Tab" || (!document.body.classList.contains("site-is-locked")&&!document.body.classList.contains("site-access-pending")))return;
  const admin=$("admin-modal");
  const scope=admin&&!admin.classList.contains("hidden")?admin:$("site-lock-screen");
  const focusables=[...scope.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(element=>!element.hidden && element.getAttribute("aria-hidden")!=="true");
  if(!focusables.length){event.preventDefault();return;}
  const first=focusables[0],last=focusables[focusables.length-1];
  if(event.shiftKey && (document.activeElement===first || !scope.contains(document.activeElement))){event.preventDefault();last.focus();}
  else if(!event.shiftKey && (document.activeElement===last || !scope.contains(document.activeElement))){event.preventDefault();first.focus();}
},true);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")refreshSiteAccess();
});
window.addEventListener("online",()=>refreshSiteAccess());
window.addEventListener("pageshow",()=>refreshSiteAccess());


async function showAdmin(session) {
  let isAdmin = false;
  if (session && supabaseClient) {
    const { data, error } = await supabaseClient.rpc("is_event_admin");
    isAdmin = !error && data === true;
  }
  $("login-view").classList.toggle("hidden", isAdmin);
  $("admin-view").classList.toggle("hidden", !isAdmin);
  if (session && !isAdmin) {
    $("login-error").textContent = "هذا الحساب غير مخوّل لإدارة الفعالية. أضف حسابه إلى جدول event_admins من Supabase.";
    stopAdminLiveUpdates();
    return;
  }
  if(isAdmin){
    $("admin-email").textContent=session.user.email||"المدير";
    $("site-lock-message-input").value=siteAccessSettings.message||"";
    $("site-lock-unlock-at").value=siteAccessSettings.unlock_at?new Date(new Date(siteAccessSettings.unlock_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):"";
    renderAdminBooths();
    startAdminLiveUpdates();
  } else {
    stopAdminLiveUpdates();
  }
}
async function checkSession(){
  if(!supabaseClient){$("login-error").textContent="قاعدة البيانات غير مربوطة بعد. أكمل إعداد Supabase حسب ملف README.";return;}
  const {data}=await supabaseClient.auth.getSession(); showAdmin(data.session);
  supabaseClient.auth.onAuthStateChange((_event,session)=>showAdmin(session));
}
$("login-btn").addEventListener("click",async()=>{
  if(!supabaseClient){$("login-error").textContent="أكمل إعداد Supabase أولًا.";return;}
  $("login-error").textContent="";
  const {data,error}=await supabaseClient.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  if(error){$("login-error").textContent="تعذر تسجيل الدخول. تأكد من بيانات المدير وإعدادات المشروع.";return;}
  showAdmin(data.session); await loadData();
});
$("logout-btn").addEventListener("click",async()=>{await supabaseClient.auth.signOut();showAdmin(null);});

function renderAdminBooths(){
  const root=$("admin-booths"); root.innerHTML="";
  const add=document.createElement("button"); add.className="primary full";add.textContent="+ إضافة بوث";add.disabled=booths.length>=5;
  add.addEventListener("click",()=>openEditor());root.append(add);
  booths.forEach(b=>{
    const row=document.createElement("div");row.className="admin-booth-row";
    const name=document.createElement("span");name.textContent=`${ar(b.booth_number)}. ${b.name}`;
    const actions=document.createElement("div");actions.className="row-actions";
    const qr=document.createElement("button");qr.className="small-btn";qr.textContent="QR";qr.type="button";qr.onclick=()=>openBoothQr(b);
    const edit=document.createElement("button");edit.className="small-btn";edit.textContent="تعديل";edit.onclick=()=>openEditor(b);
    const del=document.createElement("button");del.className="small-btn danger";del.textContent="حذف";del.onclick=()=>deleteBooth(b.id);
    actions.append(qr,edit,del);row.append(name,actions);root.append(row);
  });
}
function getBoothVisitUrl(boothId){
  const url=new URL(window.location.href);
  url.searchParams.set("booth",String(boothId));
  url.hash="";
  return url.toString();
}
function openBoothQr(booth){
  const visitUrl=getBoothVisitUrl(booth.id);
  $("booth-qr-title").textContent=`QR · ${booth.name}`;
  $("booth-qr-caption").textContent=`رمز تسجيل زيارة: ${booth.name}`;
  $("booth-qr-image").src=`https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=16&data=${encodeURIComponent(visitUrl)}`;
  $("booth-qr-open").href=visitUrl;
  $("booth-qr-open").textContent="فتح رابط الزيارة";
  $("booth-qr-modal").classList.remove("hidden");
}
$("booth-qr-close")?.addEventListener("click",()=>$("booth-qr-modal").classList.add("hidden"));
$("booth-qr-modal")?.addEventListener("click",e=>{if(e.target===$("booth-qr-modal"))$("booth-qr-modal").classList.add("hidden");});

function openEditor(b=null){
  if(!b && booths.length>=5){toast("وصلت للحد الأعلى: ٥ بوثات");return;}
  editing=Boolean(b);$("booth-editor").classList.remove("hidden");
  $("editor-title").textContent=b?"تعديل بيانات البوث":"إضافة بوث جديد";
  $("edit-id").value=b?.id||"";
  $("edit-name").value=b?.name||"";$("edit-category").value=b?.category||"";
  $("edit-description").value=b?.description||"";$("edit-location").value=b?.location||"";
  $("edit-x").value=b?.x??50;$("edit-y").value=b?.y??50;syncBoothPreviewImage();updateCoords();
  $("save-status").textContent="اضغط على الخريطة لتحديد موقع البوث أو حرّك المؤشرات.";
  $("booth-editor").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function updateCoords(){
  $("x-value").textContent=$("edit-x").value+"%";
  $("y-value").textContent=$("edit-y").value+"%";
  updateBoothPreviewMarker();
}
function updateBoothPreviewMarker(){
  const marker=$("booth-preview-marker");
  if(!marker)return;
  marker.style.left=Number($("edit-x").value)+"%";
  marker.style.top=Number($("edit-y").value)+"%";
}
function syncBoothPreviewImage(){
  const source=$("floorplan");
  const preview=$("booth-preview-image");
  if(source&&preview)preview.src=source.src;
}
function moveBoothPreview(clientX,clientY){
  const preview=$("booth-live-preview");
  const rect=preview.getBoundingClientRect();
  const x=Math.max(1,Math.min(99,Math.round((clientX-rect.left)/rect.width*100)));
  const y=Math.max(1,Math.min(99,Math.round((clientY-rect.top)/rect.height*100)));
  $("edit-x").value=x;$("edit-y").value=y;updateCoords();
}
let boothPreviewDragging=false;
$("booth-live-preview")?.addEventListener("pointerdown",e=>{
  boothPreviewDragging=true;
  e.currentTarget.setPointerCapture(e.pointerId);
  moveBoothPreview(e.clientX,e.clientY);
});
$("booth-live-preview")?.addEventListener("pointermove",e=>{
  if(boothPreviewDragging)moveBoothPreview(e.clientX,e.clientY);
});
$("booth-live-preview")?.addEventListener("pointerup",()=>{boothPreviewDragging=false;});
$("booth-live-preview")?.addEventListener("pointercancel",()=>{boothPreviewDragging=false;});
$("edit-x").addEventListener("input",updateCoords);$("edit-y").addEventListener("input",updateCoords);
$("cancel-edit").addEventListener("click",()=>$("booth-editor").classList.add("hidden"));

$("save-booth").addEventListener("click",async()=>{
  if(!supabaseClient)return;
  const name=$("edit-name").value.trim();
  if(!name){$("save-status").textContent="اكتب اسم البوث أولًا.";return;}
  const id=$("edit-id").value;
  const payload={name,category:$("edit-category").value.trim(),description:$("edit-description").value.trim(),location:$("edit-location").value.trim(),x:Number($("edit-x").value),y:Number($("edit-y").value),icon:"✚"};
  let result;
  if(id) result=await supabaseClient.from("booths").update(payload).eq("id",id);
  else {const next=Math.max(0,...booths.map(b=>b.booth_number))+1;result=await supabaseClient.from("booths").insert({...payload,booth_number:next});}
  if(result.error){console.error(result.error);$("save-status").textContent="تعذر الحفظ. تأكد من تشغيل SQL وسياسات الصلاحيات.";return;}
  $("booth-editor").classList.add("hidden");await loadData();toast("تم حفظ بيانات البوث");
});
async function deleteBooth(id){
  if(!confirm("هل أنت متأكد من حذف هذا البوث؟"))return;
  const {error}=await supabaseClient.from("booths").delete().eq("id",id);
  if(error){toast("تعذر حذف البوث؛ تحقق من الصلاحيات.");return;}
  if(selectedId===id){selectedId=null;clearDetails();}
  await loadData();toast("تم حذف البوث");
}

$("upload-map").addEventListener("click",async()=>{
  if(!supabaseClient)return;
  const file=$("map-upload").files[0];if(!file){$("map-status").textContent="اختر صورة المخطط أولًا.";return;}
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){ $("map-status").textContent="الصيغ المدعومة: JPG وPNG وWEBP.";return;}
  if(file.size>5*1024*1024){$("map-status").textContent="حجم الصورة يجب ألا يتجاوز ٥ ميجابايت.";return;}
  $("map-status").textContent="جارٍ رفع الصورة...";
  const ext=file.name.split(".").pop().toLowerCase();
  const path=`floor-plan-${Date.now()}.${ext}`;
  const {error:uploadError}=await supabaseClient.storage.from("event-map").upload(path,file,{upsert:true,contentType:file.type});
  if(uploadError){console.error(uploadError);$("map-status").textContent="فشل الرفع. تأكد من إنشاء bucket باسم event-map.";return;}
  const {data}=supabaseClient.storage.from("event-map").getPublicUrl(path);
  const {error:saveError}=await supabaseClient.from("site_settings").upsert({key:"map_url",value:data.publicUrl});
  if(saveError){$("map-status").textContent="تم رفع الصورة لكن تعذر حفظ رابطها.";return;}
  setMap(data.publicUrl);$("map-status").textContent="تم تحديث صورة المخطط لجميع الزوار.";toast("تم رفع المخطط بنجاح");
});

function getVisitorKey() {
  const keyName = "antibiotics-event-visitor-id";
  try {
    let key = localStorage.getItem(keyName);
    if (!key || !/^[0-9a-f-]{36}$/i.test(key)) {
      key = window.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
        const random = Math.random() * 16 | 0;
        return (char === "x" ? random : (random & 3 | 8)).toString(16);
      });
      localStorage.setItem(keyName, key);
    }
    return key;
  } catch (error) {
    return window.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      return (char === "x" ? random : (random & 3 | 8)).toString(16);
    });
  }
}

async function recordEventVisit() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.rpc("record_event_visit", { p_visitor_key: getVisitorKey() });
  if (error) console.warn("Visit tracking is unavailable until the dashboard SQL upgrade is applied.", error);
}

async function start(){
  if(!supabaseClient){
    $("map-empty").classList.remove("hidden");
    $("login-error").textContent="اربط المشروع بـ Supabase لإتاحة إدارة البوثات وحفظها للزوار.";
    $("site-lock-title").textContent="تعذر التحقق من حالة الموقع";
    $("site-lock-message").textContent="تعذر الاتصال بالخادم. أعد تحميل الصفحة أو تواصل مع فريق التنظيم.";
    document.body.classList.add("site-access-pending","site-is-locked");
    $("site-lock-screen")?.classList.remove("hidden");
    setAccessConnectionState("CHANNEL_ERROR");
    booths=[];renderAll();return;
  }
  await refreshSiteAccess();
  startSiteAccessRealtime();
  await recordEventVisit();
  await loadData();await checkSession();
  if(siteAccessRefreshTimer)clearInterval(siteAccessRefreshTimer);
  siteAccessRefreshTimer=setInterval(()=>refreshSiteAccess(),3000);
  setInterval(()=>{
    if(siteAccessSettings.locked&&siteAccessSettings.unlock_at)applySiteAccess();
    const scheduledUnlockPassed=siteAccessSettings.locked&&siteAccessSettings.unlock_at&&new Date(siteAccessSettings.unlock_at).getTime()<=Date.now();
    if(siteAccessLastVerifiedAt && Date.now()-siteAccessLastVerifiedAt>12000 && !scheduledUnlockPassed){
      document.body.classList.add("site-access-pending","site-is-locked");
      $("site-lock-screen")?.classList.remove("hidden");
      $("site-lock-title").textContent="بانتظار التحقق من الاتصال";
      $("site-lock-message").textContent="توقف الاتصال بالخادم مؤقتًا. سنعيد فتح الموقع تلقائيًا فور التأكد من حالة الإتاحة.";
    }
  },3000);
}
start();



(()=>{
 const canvas=$("game-canvas"); if(!canvas)return;
 const ctx=canvas.getContext("2d");
 let width=800,height=430,dpr=1,raf=0,running=false,ended=false,score=0,best=0;
 let player={x:width*.27,y:height*.48,vy:0};
 let obstacles=[],frame=0,lastTime=0,obstacleTimer=0,submitPending=false,particles=[];
 let soundEnabled=localStorage.getItem("comic-sound")!=="off",audioContext=null,lastBump=0;
 window.addEventListener("comic:sound-change",e=>{soundEnabled=Boolean(e.detail?.enabled);});
 let currentRunId=null,scoreSubmitted=false;
 function createRunId(){
   if(window.crypto?.randomUUID)return window.crypto.randomUUID();
   return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
     const r=Math.random()*16|0;return (c==="x"?r:(r&3|8)).toString(16);
   });
 }
 const BASE_GRAVITY=.34,BASE_LIFT=-6.2,BASE_GAP=154,BASE_SPEED=2.7,OBSTACLE_WIDTH=54;
 function difficulty(){
   const tier=Math.floor(score/10);
   const verticalMargin=Math.min(54,Math.max(34,height*.14));
   const maxGap=Math.max(108,height-verticalMargin*2);
   const startGap=Math.min(BASE_GAP,maxGap);
   const minGap=Math.min(108,maxGap);
   return {
     level:tier+1,
     gravity:Math.min(BASE_GRAVITY+tier*.018,.49),
     lift:Math.max(BASE_LIFT-tier*.13,-7.8),
     gap:Math.max(startGap-tier*6,minGap),
     speed:Math.min(BASE_SPEED+tier*.32,5.6),
     spawnInterval:Math.max(88-tier*4,54),
     margin:verticalMargin
   };
 }
 function updateDifficultyUI(){
   const current=difficulty();
   $("game-level").textContent=scoreText(current.level);
   $("game-difficulty-note").textContent=current.level===1
     ?"تزداد الصعوبة كل ١٠ نقاط"
     :`المستوى ${scoreText(current.level)}: سرعة أعلى وفجوات أضيق`;
 }
 function playTone(freq=520,duration=.07,type="sine",volume=.035,slide=0){
   if(!soundEnabled)return;
   try{
     const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
     audioContext=audioContext||new AudioCtx();if(audioContext.state==="suspended")audioContext.resume();
     const osc=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
     osc.type=type;osc.frequency.setValueAtTime(freq,now);if(slide)osc.frequency.exponentialRampToValueAtTime(Math.max(40,freq+slide),now+duration);
     gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
     osc.connect(gain);gain.connect(audioContext.destination);osc.start(now);osc.stop(now+duration);
   }catch(e){}
 }
 function burst(x,y,color="#E8FAFB",count=10){
   for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,sp=1+Math.random()*3;particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:24+Math.random()*12,max:36,size:1.5+Math.random()*2,color});}
 }
 function updateParticles(dt){particles=particles.filter(p=>p.life>0);particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.035*dt;p.life-=dt;});}
 function drawParticles(){particles.forEach(p=>{ctx.save();ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=8;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();ctx.restore();});}
 const scoreText=n=>new Intl.NumberFormat("ar-SA").format(n);
 function resize(){
   const rect=canvas.getBoundingClientRect();dpr=Math.min(window.devicePixelRatio||1,2);
   width=Math.max(320,rect.width);height=Math.max(240,rect.height);
   canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
   ctx.setTransform(dpr,0,0,dpr,0,0);
   if(!running)draw();
 }
 function capsule(x,y){
   ctx.save();ctx.translate(x,y);ctx.rotate(Math.max(-.45,Math.min(.55,player.vy*.055)));
   ctx.shadowColor="#21B9C7";ctx.shadowBlur=15;
   const w=39,h=19;
   ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,h/2);ctx.clip();
   const grad=ctx.createLinearGradient(-w/2,0,w/2,0);grad.addColorStop(0,"#E8FAFB");grad.addColorStop(.49,"#E8FAFB");grad.addColorStop(.51,"#21B9C7");grad.addColorStop(1,"#21B9C7");
   ctx.fillStyle=grad;ctx.fillRect(-w/2,-h/2,w,h);
   ctx.restore();
   ctx.save();ctx.translate(x,y);ctx.rotate(Math.max(-.45,Math.min(.55,player.vy*.055)));ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(-19.5,-9.5,39,19,10);ctx.stroke();ctx.restore();
 }
 function drawCell(x,y,r,alpha=1){
   ctx.save();ctx.globalAlpha=alpha;const g=ctx.createRadialGradient(x-r*.3,y-r*.3,2,x,y,r);g.addColorStop(0,"#18A6B5");g.addColorStop(.7,"#087987");g.addColorStop(1,"#073443");ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#E8FAFB55";ctx.lineWidth=3;ctx.stroke();ctx.restore();
 }
 function background(){
   const g=ctx.createLinearGradient(0,0,0,height);g.addColorStop(0,"#073443");g.addColorStop(1,"#061522");ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
   for(let i=0;i<7;i++){const x=((i*151-frame*.25)%(width+100)+width+100)%(width+100);drawCell(x,45+(i*79)%Math.max(100,height-70),13+(i%3)*5,.3);}
   ctx.strokeStyle="#0B647555";ctx.lineWidth=2;
   for(let y=35;y<height;y+=70){ctx.beginPath();ctx.moveTo(0,y+Math.sin((frame+y)*.012)*9);ctx.bezierCurveTo(width*.3,y-20,width*.7,y+20,width,y+Math.cos((frame+y)*.012)*9);ctx.stroke();}
   for(let i=0;i<18;i++){const x=(i*71+frame*.55)%(width+10),y=(i*47+Math.sin(frame*.025+i)*20)%height;ctx.fillStyle="#E8FAFB77";ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();}
 }
 function drawObstacle(o){
   const w=OBSTACLE_WIDTH,gapSize=o.gap;
   const grad=ctx.createLinearGradient(o.x,0,o.x+w,0);grad.addColorStop(0,"#087987");grad.addColorStop(.5,"#E8FAFB");grad.addColorStop(1,"#21B9C7");
   ctx.fillStyle=grad;ctx.shadowColor="#18A6B544";ctx.shadowBlur=10;
   ctx.beginPath();ctx.roundRect(o.x,-8,w,o.top+8,[0,0,13,13]);ctx.fill();
   ctx.beginPath();ctx.roundRect(o.x,o.top+gapSize,w,height-o.top-gapSize+8,[13,13,0,0]);ctx.fill();ctx.shadowBlur=0;
   ctx.fillStyle="#21B9C7";ctx.fillRect(o.x-5,o.top-12,w+10,12);ctx.fillRect(o.x-5,o.top+gapSize,w+10,12);
   for(let j=0;j<3;j++){drawCell(o.x+12+j*15,Math.max(14,o.top-28),5,.65);drawCell(o.x+12+j*15,Math.min(height-12,o.top+gapSize+28),5,.65);}
 }
 function draw(){
   background();obstacles.forEach(drawObstacle);drawParticles();capsule(player.x,player.y);
   if(running){ctx.fillStyle="#E8FAFBAA";ctx.font='bold 12px "MediaPro", "Arabic Diwani", Tahoma, sans-serif';ctx.textAlign="right";ctx.fillText("رحلة داخل مجرى الدم",width-16,25);}
 }
 function reset(){
   score=0;frame=0;obstacleTimer=0;obstacles=[];particles=[];player={x:Math.max(75,width*.27),y:height*.48,vy:0};
   currentRunId=createRunId();scoreSubmitted=false;
   $("submit-score").disabled=false;$("score-status").textContent="";
   $("game-score").textContent=scoreText(0);$("game-submit").classList.add("hidden");updateDifficultyUI();
   ended=false;submitPending=false;
 }
 function start(){
   if(raf)cancelAnimationFrame(raf);reset();running=true;
   $("game-overlay").classList.add("hidden");lastTime=0;raf=requestAnimationFrame(loop);
 }
 function flap(){if(running){player.vy=difficulty().lift;burst(player.x-15,player.y,"#E8FAFB",3);playTone(570,.055,"sine",.022,170);}else if(ended){start();}}
 function finish(){
   window.dispatchEvent(new CustomEvent("comic:game-finished",{detail:{score}}));
   running=false;ended=true;cancelAnimationFrame(raf);raf=0;burst(player.x,player.y,"#18A6B5",22);playTone(210,.22,"triangle",.055,-100);$("game-stage").classList.remove("bump");void $("game-stage").offsetWidth;$("game-stage").classList.add("bump");
   $("game-message-title").textContent="انتهت الرحلة!";
   $("game-message").textContent=`جمعت ${scoreText(score)} نقطة ووصلت إلى المستوى ${scoreText(difficulty().level)}. سجّل اسمك وأضف نتيجتك إلى لوحة المتصدرين.`;
   $("game-start").textContent="العب مرة ثانية";$("game-overlay").classList.remove("hidden");
   $("game-submit").classList.remove("hidden");$("player-name").focus();
 }
 function loop(time){
   if(!running)return;
   const dt=lastTime?Math.min(2,(time-lastTime)/16.67):1;lastTime=time;frame+=dt;
   const current=difficulty();
   player.vy+=current.gravity*dt;player.y+=player.vy*dt;
   obstacleTimer+=dt;
   if(obstacleTimer>=current.spawnInterval){
     obstacleTimer-=current.spawnInterval;
     const topLimit=Math.max(current.margin,height-current.gap-current.margin);
     const top=current.margin+Math.random()*Math.max(0,topLimit-current.margin);
     obstacles.push({x:width+10,top,gap:current.gap,speed:current.speed,passed:false});
   }
   obstacles.forEach(o=>{
     o.x-=o.speed*dt;
     if(!o.passed&&o.x+OBSTACLE_WIDTH<player.x){
       o.passed=true;score++;$("game-score").textContent=scoreText(score);best=Math.max(best,score);$("game-best").textContent=scoreText(best);
       if(score%10===0){updateDifficultyUI();burst(player.x+18,player.y,"#18A6B5",18);playTone(920,.18,"triangle",.045,340);}
       else{burst(player.x+18,player.y,"#E8FAFB",9);playTone(760,.09,"sine",.035,260);}
       $("game-stage").classList.remove("score-pop");void $("game-stage").offsetWidth;$("game-stage").classList.add("score-pop");
     }
     const hitX=player.x+15>o.x&&player.x-15<o.x+OBSTACLE_WIDTH;
     const hitY=player.y-8<o.top||player.y+8>o.top+o.gap;
     if(hitX&&hitY)finish();
   });
   obstacles=obstacles.filter(o=>o.x>-65);
   if(player.y<8||player.y>height-8)finish();
   updateParticles(dt);draw();if(running)raf=requestAnimationFrame(loop);
 }
 $("game-start").addEventListener("click",()=>{playTone(480,.08,"sine",.025,180);start();});
 $("game-flap").addEventListener("click",flap);
 $("game-sound").addEventListener("click",()=>{soundEnabled=!soundEnabled;localStorage.setItem("comic-sound",soundEnabled?"on":"off");$("game-sound").textContent=soundEnabled?"🔊 الصوت يعمل":"🔇 الصوت مكتوم";$("game-sound").setAttribute("aria-pressed",String(soundEnabled));window.dispatchEvent(new CustomEvent("comic:sound-change",{detail:{enabled:soundEnabled}}));if(soundEnabled)playTone(620,.08,"sine",.025,120);});
 $("game-stage").addEventListener("pointerdown",e=>{if(e.target.closest(".game-overlay"))return;e.preventDefault();flap();});
 window.addEventListener("keydown",e=>{if((e.code==="Space"||e.code==="ArrowUp")&&$("game").getBoundingClientRect().top<window.innerHeight&&$("game").getBoundingClientRect().bottom>0){e.preventDefault();if(!running&&ended)return;flap();}});
 window.addEventListener("resize",resize);resize();
 const PLAYER_NAME_KEY="antibiotics-event-player-name";
 const QUIZ=[
  {q:"متى يمكن أن تكون المضادات الحيوية مفيدة؟",a:["لعلاج نزلات البرد والإنفلونزا","لعلاج بعض العدوى البكتيرية عندما يقرر المختص الحاجة إليها","لعلاج جميع أنواع الألم","للوقاية من كل أنواع العدوى"],why:"المضادات الحيوية تعالج بعض العدوى التي تسببها البكتيريا، ويحدد المختص متى تكون مناسبة."},
  {q:"ما الذي يكتسب القدرة على مقاومة المضاد الحيوي؟",a:["جسم الإنسان","جهاز المناعة","البكتيريا","الدواء نفسه"],why:"المقاومة تحدث عندما تطوّر البكتيريا القدرة على التصدي للأدوية المصممة للقضاء عليها."},
  {q:"ما الصحيح بخصوص نزلات البرد والإنفلونزا؟",a:["المضادات الحيوية لا تعالج الفيروسات المسببة لها","تحتاج دائمًا إلى مضاد حيوي","زيادة الجرعة تسرّع الشفاء","يمكن استخدام أي مضاد متوفر"],why:"المضادات الحيوية لا تعمل ضد الفيروسات، ومنها الفيروسات المسببة للبرد والإنفلونزا."},
  {q:"ماذا تفعل بالمضاد الحيوي المتبقي من وصفة سابقة؟",a:["تحتفظ به للمرض القادم","تعطيه لشخص لديه أعراض مشابهة","تضاعف الجرعة عند الحاجة","لا تستخدمه لاحقًا أو تشاركه، واسأل الصيدلي عن التخلص الآمن منه"],why:"لا تستخدم بقايا المضادات لمرض آخر ولا تشاركها؛ فقد لا تكون مناسبة وقد تؤخر العلاج الصحيح."},
  {q:"إذا وصف لك الطبيب مضادًا حيويًا، فما التصرف الصحيح؟",a:["توقف عنه أو تغيّر الجرعة بمجرد التحسن","تلتزم بالجرعة والتعليمات الموصوفة وتستشير المختص عند وجود مشكلة","تشارك الدواء مع أحد أفراد الأسرة","تضاعف الجرعة إذا نسيت جرعة"],why:"استخدم المضاد تمامًا وفق تعليمات الطبيب أو الصيدلي، ولا تغيّر العلاج بنفسك."}
 ];
let savedPlayerName = "";

try {
    savedPlayerName =
        localStorage.getItem(PLAYER_NAME_KEY) ||
        localStorage.getItem("profile-name-locked") ||
        "";
} catch (e) {
}

const normalizeName = value =>
    String(value || "").trim().replace(/\s+/g, " ");

const isFullName = value => normalizeName(value).length > 0;

const getPlayerName = () => normalizeName(savedPlayerName);


function rememberPlayerName(name) {
    savedPlayerName = normalizeName(name);

    [
        "profile-name",
        "player-name",
        "booth-checkin-player"
    ].forEach(id => {
        const field = $(id);

        if (field) {
            field.value = savedPlayerName;
            field.readOnly = true;
        }
    });

    try {
        localStorage.setItem(PLAYER_NAME_KEY, savedPlayerName);
        localStorage.setItem("profile-name-locked", savedPlayerName);
    } catch (e) {
    }
}


function showIdentityGate() {
    const modal = $("identity-modal");

    if (!isFullName(savedPlayerName)) {
        modal?.classList.remove("hidden");
        document.body.classList.add("identity-lock");

        setTimeout(() => $("identity-name")?.focus(), 100);
    } else {
        rememberPlayerName(savedPlayerName);

        modal?.classList.add("hidden");
        document.body.classList.remove("identity-lock");
    }
}
$("identity-save")?.addEventListener("click", async () => {
    if (isFullName(savedPlayerName)) {
        showIdentityGate();
        return;
    }

    const name = normalizeName($("identity-name").value);

    if (!isFullName(name)) {
        $("identity-status").textContent = "اكتب اسمًا للمتابعة.";
        $("identity-name").focus();
        return;
    }
    if (!supabaseClient) {
        $("identity-status").textContent = "تعذر الاتصال بقاعدة البيانات للتحقق من الاسم. حاول مرة أخرى.";
        return;
    }
    const saveButton = $("identity-save");
    saveButton.disabled = true;
    $("identity-status").textContent = "جارٍ التحقق من الاسم...";
    const { data: registration, error: registrationError } = await supabaseClient.rpc("register_event_participant", { p_player_name: name, p_owner_token: getArtOwnerToken() });
    saveButton.disabled = false;
    if (registrationError || !registration?.success) {
        $("identity-status").textContent = registration?.reason === "NAME_TAKEN" ? "هذا الاسم مستخدم بالفعل. اختر اسمًا آخر." : registration?.reason === "CAPACITY_FULL" ? "اكتمل عدد المشاركين (١٢٠ مشاركًا)." : "تعذر اعتماد الاسم. تحقق من تحديث قاعدة البيانات ثم حاول مجددًا.";
        $("identity-name").focus();
        return;
    }

    rememberPlayerName(name);

    $("identity-status").textContent = "تم اعتماد اسمك بنجاح.";

    showIdentityGate();

    await loadVisitedBoothCards();

    if (pendingQrBooth) {
        $("booth-checkin-player").value = name;
        $("booth-checkin-modal")?.classList.remove("hidden");
    }
});
$("identity-name")?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
        $("identity-save")?.click();
    }
});
if (savedPlayerName && !isFullName(savedPlayerName)) {
    savedPlayerName = "";
}
showIdentityGate();
 function renderQuiz(){
   const root=$("quiz-questions");if(!root)return;root.innerHTML="";
   QUIZ.forEach((question,index)=>{
     const card=document.createElement("fieldset");card.className="quiz-question";
     const legend=document.createElement("legend");legend.textContent=`${ar(index+1)}. ${question.q}`;
     const options=document.createElement("div");options.className="quiz-options";
     question.a.forEach((answer,optionIndex)=>{
       const label=document.createElement("label");label.className="quiz-option";
       const radio=document.createElement("input");radio.type="radio";radio.name=`quiz-answer-${index}`;radio.value=String(optionIndex);
       const text=document.createElement("span");text.textContent=answer;
       label.append(radio,text);options.append(label);
     });
     card.append(legend,options);root.append(card);
   });
 }
 async function loadVisitedBoothCards(){
   const name=getPlayerName();
   if(!name||!supabaseClient)return;
   const {data,error}=await supabaseClient.rpc("get_visited_booths",{p_player_name:name});
   if(error){console.error("Visited booths:",error);return;}
   (data||[]).forEach(item=>{
     const visitedBooth=booths.find(booth=>String(booth.id)===String(item.booth_id));
     if(visitedBooth)window.dispatchEvent(new CustomEvent("comic:booth-card",{detail:{boothId:String(visitedBooth.id),boothName:visitedBooth.name}}));
   });
 }

 let pendingQrBooth = null;
 async function openBoothCheckin(){
   const boothId=new URLSearchParams(window.location.search).get("booth");
   if(!boothId || !supabaseClient)return;
   const booth=booths.find(item=>String(item.id)===String(boothId));
   if(!booth){$("booth-checkin-status").textContent="تعذر العثور على هذا البوث. تأكد من أن رمز QR ما زال صالحًا.";return;}
   pendingQrBooth=booth;
   $("booth-checkin-name").textContent=booth.name;
   if(!isFullName(getPlayerName())){showIdentityGate();return;}
   $("booth-checkin-player").value=getPlayerName();
   $("booth-checkin-status").textContent="";
   $("booth-checkin-modal").classList.remove("hidden");
 }
 window.addEventListener("event-booths-loaded",openBoothCheckin);
 $("booth-checkin-close")?.addEventListener("click",()=>$("booth-checkin-modal").classList.add("hidden"));
 $("booth-checkin-modal")?.addEventListener("click",e=>{if(e.target===$("booth-checkin-modal"))$("booth-checkin-modal").classList.add("hidden");});
 $("booth-checkin-submit")?.addEventListener("click",async()=>{
   if(!pendingQrBooth)return;
   const name=getPlayerName();
   if(!isFullName(name)){showIdentityGate();$("booth-checkin-status").textContent="أدخل اسم المشاركة أولًا.";return;}
   const button=$("booth-checkin-submit");button.disabled=true;$("booth-checkin-status").textContent="جارٍ تسجيل زيارتك...";
   const {data,error}=await supabaseClient.rpc("record_booth_visit",{p_booth_id:String(pendingQrBooth.id),p_player_name:name});
   button.disabled=false;
   if(error){console.error("Booth visit:",error);$("booth-checkin-status").textContent="تعذر تسجيل الزيارة. تحقق من تشغيل ملف supabase-unified-setup.sql أولًا.";return;}
   rememberPlayerName(name);
   $("booth-checkin-status").textContent=data?.already_visited?"هذه الزيارة مسجلة مسبقًا.":"تم تسجيل زيارتك بنجاح.";
   $("booth-checkin-submit").textContent=data?.already_visited?"تم تسجيل الزيارة":"تمت الزيارة ✓";
   await loadVisitedBoothCards();
   window.dispatchEvent(new CustomEvent("comic:booth-card",{detail:{boothId:String(pendingQrBooth.id),boothName:pendingQrBooth.name}}));
   if (!data?.already_visited) window.dispatchEvent(new CustomEvent("comic:booth-visited",{detail:{boothId:String(pendingQrBooth.id),boothName:pendingQrBooth.name}}));
 });
 renderQuiz();
 $("quiz-submit")?.addEventListener("click",async()=>{
   const name=getPlayerName();
   if(!isFullName(name)){showIdentityGate();$("quiz-status").textContent="أدخل اسم المشاركة أولًا.";return;}
   const answers=QUIZ.map((q,index)=>{const selected=document.querySelector(`input[name="quiz-answer-${index}"]:checked`);return selected?Number(selected.value):null;});
   if(answers.some(answer=>answer===null)){$("quiz-status").textContent="أجب عن الأسئلة الخمسة قبل اعتماد إجاباتك.";return;}
   if(!supabaseClient){$("quiz-status").textContent="اربط الموقع بـ Supabase لتسجيل نقاط الاختبار.";return;}
   const button=$("quiz-submit");button.disabled=true;$("quiz-status").textContent="جارٍ تصحيح إجاباتك وتسجيل النقاط...";
   const {data,error}=await supabaseClient.rpc("submit_quiz_score",{p_name:name,p_answers:answers});
   button.disabled=false;
   if(error){console.error(error);$("quiz-status").textContent="تعذر تسجيل نتيجتك. تحقق من تشغيل ملف supabase-unified-setup.sql أولًا.";return;}
   rememberPlayerName(name);
   const correct=Number(data?.correct_count||0),points=Number(data?.score||0);
   $("quiz-result-title").textContent=correct===5?"ممتاز! إجابات كاملة 🎉":"أحسنت، استمر في التعلم!";
   $("quiz-result-text").textContent=`إجابات صحيحة: ${ar(correct)} من ٥ · نقاط هذه المحاولة: ${ar(points)} · أُضيفت النقاط إلى مجموعك في لوحة المتصدرين.`;
   $("quiz-result").classList.remove("hidden");$("quiz-reset").classList.remove("hidden");button.classList.add("hidden");$("quiz-status").textContent="تم تسجيل الاختبار بنجاح.";
   const correctAnswers=Array.isArray(data?.correct_answers)?data.correct_answers:[1,2,0,3,1];
   const review=$("quiz-review");review.innerHTML="";
   QUIZ.forEach((question,index)=>{
     const isCorrect=answers[index]===Number(correctAnswers[index]);
     const item=document.createElement("article");item.className=`quiz-review-item ${isCorrect?"right":"wrong"}`;
     const title=document.createElement("b");title.textContent=`${ar(index+1)}. ${isCorrect?"إجابة صحيحة":"الإجابة الصحيحة: "+question.a[Number(correctAnswers[index])]}`;
     const explanation=document.createElement("p");explanation.textContent=question.why;
     item.append(title,explanation);review.append(item);
   });
   review.classList.remove("hidden");
   await loadLeaders();
   window.dispatchEvent(new CustomEvent("comic:quiz-completed",{detail:{points}}));
 });
 $("quiz-reset")?.addEventListener("click",()=>{
   document.querySelectorAll('#quiz-questions input[type="radio"]').forEach(input=>input.checked=false);
   $("quiz-result").classList.add("hidden");$("quiz-review").classList.add("hidden");$("quiz-review").innerHTML="";$("quiz-reset").classList.add("hidden");$("quiz-submit").classList.remove("hidden");$("quiz-status").textContent="اختبار جديد جاهز. نقاط المحاولات السابقة محفوظة.";
 });

 async function loadLeaders(){
   const root=$("leaderboard");
   if(!supabaseClient){root.innerHTML='<p class="leader-empty">اربط Supabase لعرض لوحة المتصدرين وحفظ مجموع النقاط.</p>';return;}
   const {data,error}=await supabaseClient.from("event_leaderboard").select("display_name,total_score,game_points,quiz_points").order("total_score",{ascending:false}).limit(10);
   if(error){console.error(error);root.innerHTML='<p class="leader-empty">تعذر تحميل النتائج حاليًا.</p>';return;}
   if(!data?.length){root.innerHTML='<p class="leader-empty">كن أول من يسجل اسمه في لوحة المتصدرين!</p>';return;}
   root.innerHTML="";
   data.forEach((item,index)=>{
     const row=document.createElement("div");row.className="leader-row";
     const rank=document.createElement("span");rank.className="leader-rank";rank.textContent=scoreText(index+1);
     const nameWrap=document.createElement("div");nameWrap.className="leader-name-wrap";
     const name=document.createElement("span");name.className="leader-name";name.textContent=item.display_name;
     const breakdown=document.createElement("small");breakdown.className="leader-breakdown";breakdown.textContent=`اللعبة ${scoreText(item.game_points)} · الاختبار ${scoreText(item.quiz_points)}`;
     nameWrap.append(name,breakdown);
     const points=document.createElement("span");points.className="leader-points";points.textContent=scoreText(item.total_score)+" نقطة";
     row.append(rank,nameWrap,points);root.append(row);
   });
 }
 $("submit-score").addEventListener("click",async()=>{
   if(!supabaseClient){$("score-status").textContent="لوحة المتصدرين تحتاج ربط Supabase أولًا.";return;}
   if(score<1){$("score-status").textContent="حاول تجمع نقطة واحدة على الأقل قبل التسجيل.";return;}
   const name=getPlayerName();
   if(!isFullName(name)){$("score-status").textContent="أدخل اسم المشاركة أولًا.";showIdentityGate();return;}
   if(!ended){$("score-status").textContent="يمكن تسجيل النتيجة بعد انتهاء الجولة فقط.";return;}
   if(scoreSubmitted){$("score-status").textContent="تم تسجيل نتيجة هذه الجولة مسبقًا. ابدأ جولة جديدة لتسجيل نتيجة أخرى.";return;}
   if(!currentRunId){$("score-status").textContent="تعذر التحقق من الجولة. ابدأ جولة جديدة.";return;}
   if(submitPending)return;
   submitPending=true;$("submit-score").disabled=true;$("score-status").textContent="جارٍ تسجيل النتيجة...";
   const {data,error}=await supabaseClient.rpc("submit_game_score_once",{
     p_run_id:currentRunId,p_name:name,p_score:score
   });
   submitPending=false;
   if(error){
     console.error(error);$("submit-score").disabled=false;
     $("score-status").textContent="تعذر تسجيل النتيجة. تحقق من تشغيل ملف supabase-unified-setup.sql ثم حاول مجددًا.";
     return;
   }
   if(data?.already_submitted){
     scoreSubmitted=true;
     $("score-status").textContent="هذه الجولة مسجلة مسبقًا ولا يمكن إضافة نقاطها مرة أخرى.";
   }else{
     scoreSubmitted=true;
     rememberPlayerName(name);
     $("score-status").textContent="تم تسجيل نتيجة هذه الجولة بنجاح! لا يمكن تكرار إضافتها.";
   }
   $("submit-score").disabled=true;
   await loadLeaders();
 });
 loadLeaders();
 loadVisitedBoothCards();
 window.addEventListener("event-booths-loaded", loadVisitedBoothCards);
(() => {

  let soundEnabled = localStorage.getItem("comic-sound") !== "off";
  let audioContext;
  function comicSound(kind = "pop") {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext ||= new AudioCtx();
      if (audioContext.state === "suspended") audioContext.resume();
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.connect(gain); gain.connect(audioContext.destination);
      const presets = {
        pop: [520, 170, .105, "square"],
        switch: [300, 620, .16, "sine"],
        reveal: [240, 920, .42, "triangle"],
        hit: [130, 55, .18, "sawtooth"]
      };
      const [from, to, duration, wave] = presets[kind] || presets.pop;
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(from, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, to), now + duration);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.12, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      oscillator.start(now); oscillator.stop(now + duration + .02);
    } catch (error) {  }
  }
  const gameSoundButton = document.getElementById("game-sound");
  const soundToggle = document.getElementById("sound-toggle");
  const syncSoundUI = () => {
    window.dispatchEvent(new CustomEvent("comic:sound-change", { detail: { enabled: soundEnabled } }));
    if (gameSoundButton) { gameSoundButton.textContent = soundEnabled ? "🔊 الصوت يعمل" : "🔇 الصوت مكتوم"; gameSoundButton.setAttribute("aria-pressed", String(soundEnabled)); }
    if (soundToggle) { soundToggle.textContent = soundEnabled ? "🔊 المؤثرات" : "🔇 المؤثرات"; soundToggle.setAttribute("aria-pressed", String(soundEnabled)); }
  };
  syncSoundUI();
  soundToggle?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("comic-sound", soundEnabled ? "on" : "off");
    syncSoundUI();
    if (soundEnabled) comicSound("switch");
  });
  gameSoundButton?.addEventListener("click", () => {
    window.setTimeout(() => {
      soundEnabled = localStorage.getItem("comic-sound") !== "off";
      syncSoundUI();
    }, 0);
  });
  document.addEventListener("click", event => {
    const target = event.target.closest("button, .booth-card, .pin");
    if (!target || target.id === "game-sound") return;
    if (target.id === "secret-emblem") return;
    comicSound("pop");
  }, true);
  let emblemTaps = 0;
  const emblem = document.getElementById("secret-emblem");
  const secret = document.getElementById("secret-challenge");
  const secretProgress = document.getElementById("secret-progress");
  const secretFound = localStorage.getItem("comic-secret-found") === "yes";
  const secretWon = localStorage.getItem("comic-secret-won") === "yes";
  if (secretFound && secret) secret.classList.remove("hidden");
  if (secretWon && secretProgress) secretProgress.textContent = "تم فتح ختم الحارس المجهول ✓";
  emblem?.addEventListener("click", () => {
    emblemTaps++;
    emblem.classList.add("secret-tap");
    window.setTimeout(() => emblem.classList.remove("secret-tap"), 240);
    if (emblemTaps >= 5) {
      localStorage.setItem("comic-secret-found", "yes");
      secret?.classList.remove("hidden");
      secret?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (secretProgress) secretProgress.textContent = secretWon ? "تم فتح ختم الحارس المجهول ✓" : "المهمة: احصل على ٥٠/٥٠ في تحدّي المعرفة.";
      comicSound("reveal");
      toast("تم اكتشاف مهمة سرية!");
      emblemTaps = 0;
    }
  });
  const originalQuizSubmit = document.getElementById("quiz-submit");
  originalQuizSubmit?.addEventListener("click", () => {
    window.setTimeout(() => {
      const result = document.getElementById("quiz-result-text")?.textContent || "";
      if (localStorage.getItem("comic-secret-found") === "yes" && /إجابات صحيحة:\s*٥ من ٥|إجابات صحيحة:\s*5 من 5/.test(result)) {
        localStorage.setItem("comic-secret-won", "yes");
        if (secretProgress) secretProgress.textContent = "تم فتح ختم الحارس المجهول ✓";
        secret?.classList.remove("hidden");
        comicSound("reveal");
        toast("إنجاز سري جديد: الحارس المجهول!");
      }
    }, 650);
  });
  window.comicSound = comicSound;
})();
(() => {
  const KEY = "comic-universe-progress-v1";
  const $id = id => document.getElementById(id);
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  let state = read();
  if (state.day !== today()) state = { ...state, day: today(), dailyGame: false, dailyQuiz: false, dailyVisit: false };
  state.totalPoints = Number(state.totalPoints || 0);
  state.visitedBooths = Array.isArray(state.visitedBooths) ? state.visitedBooths : [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} render(); };
  const missions = [
    { id: "dailyGame", title: "اختبر مهارتك", desc: "أنه جولة لعب وسجّل ٥ نقاط على الأقل.", icon: "⚡" },
    { id: "dailyQuiz", title: "عقل الحارس", desc: "أكمل الاختبار المعرفي اليوم.", icon: "✦" },
    { id: "dailyVisit", title: "مستكشف الأركان", desc: "سجّل زيارة بوث واحد عبر QR.", icon: "⌖" }
  ];
  const rankFor = points => points >= 500 ? "أسطورة الوعي" : points >= 250 ? "حارس خبير" : points >= 100 ? "حارس متقدم" : points >= 30 ? "مستكشف" : "مبتدئ";
  function render() {
    const done = missions.filter(m => state[m.id]).length;
    const label = $id("mission-progress-value"), fill = $id("mission-progress-fill"), grid = $id("daily-missions");
    if (label) label.textContent = `${new Intl.NumberFormat("ar-SA").format(done)} / ٣`;
    if (fill) fill.style.width = `${done / 3 * 100}%`;
    if (grid) {
      grid.replaceChildren();
      missions.forEach(m => {
        const card = document.createElement("article"); card.className = `mission-card${state[m.id] ? " is-complete" : ""}`;
        const icon = document.createElement("span"); icon.className = "mission-icon"; icon.textContent = m.icon;
        const title = document.createElement("b"); title.textContent = m.title;
        const desc = document.createElement("p"); desc.textContent = m.desc;
        const status = document.createElement("small"); status.textContent = state[m.id] ? "✓ مكتملة" : "قيد التنفيذ";
        card.append(icon, title, desc, status); grid.append(card);
      });
    }
    const rank = $id("hero-rank"); if (rank) rank.textContent = `رتبة: ${rankFor(state.totalPoints)}`;
    const certificate = $id("mission-certificate"); if (certificate) certificate.classList.toggle("hidden", done !== missions.length);
    const collection = $id("booth-collection");
    if (collection) {
      collection.replaceChildren();
      if (!state.visitedBooths.length) { const empty = document.createElement("span"); empty.className = "collection-empty"; empty.textContent = "ستظهر بطاقاتك بعد تسجيل الزيارات."; collection.append(empty); }
      state.visitedBooths.forEach(item => { const card = document.createElement("span"); card.className = "collection-card"; const mark = document.createElement("b"); mark.textContent = "✦"; const name = document.createElement("small"); name.textContent = item.name; card.append(mark, name); collection.append(card); });
    }
  }
  window.addEventListener("comic:game-finished", e => { const score = Number(e.detail?.score || 0); if (score >= 5) state.dailyGame = true; state.totalPoints += score; save(); });
  window.addEventListener("comic:quiz-completed", e => { state.dailyQuiz = true; state.totalPoints += Number(e.detail?.points || 0); save(); });
  const addBoothCard = e => { const id = String(e.detail?.boothId || ""); if (id && !state.visitedBooths.some(x => x.id === id)) { state.visitedBooths.push({ id, name: String(e.detail?.boothName || "بوث") }); save(); } };
  window.addEventListener("comic:booth-card", addBoothCard);
  window.addEventListener("comic:booth-visited", e => { state.dailyVisit = true; addBoothCard(e); save(); });

  async function drawCertificate() {
    const logo = new Image();
    logo.src = "assets/images/site-logo.png";
    await new Promise((resolve, reject) => { logo.onload = resolve; logo.onerror = reject; });
    const canvas = document.createElement("canvas");
    canvas.width = 1800; canvas.height = 1273;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const paper = ctx.createLinearGradient(0, 0, W, H);
    paper.addColorStop(0, "#F4E8CF");
    paper.addColorStop(.52, "#E9D9B9");
    paper.addColorStop(1, "#DCC9A5");
    ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 620; i++) {
      const x = (i * 137.5) % W, y = (i * 83.7) % H;
      ctx.fillStyle = i % 3 ? "rgba(72,55,31,.045)" : "rgba(255,255,255,.16)";
      ctx.beginPath(); ctx.arc(x, y, (i % 4) + 1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#071719"; ctx.fillRect(24, 24, W - 48, H - 48);
    ctx.fillStyle = "#E9D9B9"; ctx.fillRect(43, 43, W - 86, H - 86);
    ctx.strokeStyle = "#087B7D"; ctx.lineWidth = 9; ctx.strokeRect(66, 66, W - 132, H - 132);
    ctx.strokeStyle = "#8D7045"; ctx.lineWidth = 2; ctx.strokeRect(84, 84, W - 168, H - 168);
    const corners = [[112,112,1,1],[W-112,112,-1,1],[112,H-112,1,-1],[W-112,H-112,-1,-1]];
    corners.forEach(([x,y,sx,sy]) => {
      ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy);
      ctx.strokeStyle = "#087B7D"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0,54); ctx.lineTo(0,0); ctx.lineTo(54,0); ctx.stroke();
      ctx.fillStyle = "#B48D55"; ctx.beginPath(); ctx.arc(18,18,6,0,Math.PI*2); ctx.fill();
      ctx.restore();
    });
    ctx.save();
    ctx.fillStyle = "#0A292B"; ctx.beginPath(); ctx.arc(900, 190, 112, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#D8B987"; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(900, 190, 101, 0, Math.PI * 2); ctx.strokeStyle = "#087B7D"; ctx.lineWidth = 3; ctx.stroke();
    ctx.drawImage(logo, 820, 110, 160, 160);
    ctx.restore();
    ctx.fillStyle = "#0A292B"; ctx.fillRect(300, 305, 1200, 88);
    ctx.strokeStyle = "#D8B987"; ctx.lineWidth = 3; ctx.strokeRect(315, 320, 1170, 58);
    ctx.textAlign = "center"; ctx.direction = "rtl";
    ctx.fillStyle = "#54D1C7"; ctx.font = 'bold 34px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText("مِضادّ  |  شهادة إنجاز", 900, 360);
    ctx.fillStyle = "#0A292B"; ctx.font = 'bold 78px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText("شهادة شكر وتقدير", 900, 500);
    ctx.fillStyle = "#087B7D"; ctx.fillRect(675, 527, 450, 7);
    ctx.fillStyle = "#344B43"; ctx.font = '43px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText("تُمنح هذه الشهادة بكل فخر واعتزاز إلى", 900, 615);

    const playerName = (typeof getPlayerName === "function" && getPlayerName()) || "المشارك المتميز";
    ctx.fillStyle = "#075F61"; ctx.font = 'bold 72px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText(playerName, 900, 745, 1460);
    ctx.strokeStyle = "#A98751"; ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(370, 785); ctx.lineTo(1430, 785); ctx.stroke(); ctx.setLineDash([]);

    ctx.fillStyle = "#344B43"; ctx.font = '39px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText("وذلك لإتمام جميع مهمات فعالية مِضادّ", 900, 865);
    ctx.font = '32px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText("وتقديرًا لمشاركته وحرصه على نشر الوعي بالاستخدام الصحيح للمضادات الحيوية", 900, 925, 1500);
    ctx.fillStyle = "#0A292B"; ctx.beginPath(); ctx.arc(900, 1035, 62, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#D8B987"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(900, 1035, 51, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = "#54D1C7"; ctx.font = "bold 54px Georgia, serif"; ctx.fillText("✦", 900, 1054);
    const date = new Intl.DateTimeFormat("ar-SA", { dateStyle: "long", timeZone: "Asia/Riyadh" }).format(new Date());
    ctx.fillStyle = "#344B43"; ctx.font = '30px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText(`تاريخ الإنجاز: ${date}`, 900, 1145);
    ctx.fillStyle = "#087B7D"; ctx.font = 'bold 23px "TufuliArabicDemo", "Noto Sans Arabic", sans-serif';
    ctx.fillText("مِضادّ — المعرفة مسؤولية والوعي حماية", 900, 1190);
    return canvas;
  }
  $id("certificate-download")?.addEventListener("click", async () => {
    if (missions.some(m => !state[m.id])) { toast("أكمل جميع المهمات أولًا لإصدار الشهادة."); return; }
    const button = $id("certificate-download");
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const previewWindow = isIOS ? window.open("about:blank", "_blank") : null;
    button.disabled = true;
    button.textContent = "جارٍ تجهيز الشهادة...";
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = await drawCertificate();
      let blob = null;
      if (typeof canvas.toBlob === "function") {
        blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      }
      const dataUrl = blob ? null : canvas.toDataURL("image/png");
      if (!blob && !dataUrl) throw new Error("تعذر إنشاء صورة الشهادة");

      const fileUrl = blob ? URL.createObjectURL(blob) : dataUrl;
      if (isIOS) {
        if (previewWindow && !previewWindow.closed) {
          previewWindow.location.href = fileUrl;
        } else {
          const fallback = document.createElement("a");
          fallback.href = fileUrl;
          fallback.target = "_blank";
          fallback.rel = "noopener";
          fallback.textContent = "فتح الشهادة وحفظها";
          fallback.className = "primary";
          fallback.style.display = "inline-flex";
          fallback.style.marginTop = "12px";
          fallback.id = "certificate-open-fallback";
          $id("mission-certificate")?.querySelector(".certificate-copy")?.append(fallback);
          fallback.click();
        }
        toast("تم فتح الشهادة. اضغط عليها مطولًا ثم اختر حفظ في الصور.");
      } else {
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = "شهادة-شكر-وتقدير.png";
        link.rel = "noopener";
        document.body.append(link);
        link.click();
        link.remove();
        toast("تم تجهيز الشهادة. تحقق من مجلد التنزيلات.");
      }
      if (blob) window.setTimeout(() => URL.revokeObjectURL(fileUrl), 5 * 60 * 1000);
    } catch (error) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      console.error("Certificate export failed:", error);
      toast("تعذر تجهيز الشهادة. حدّث الصفحة وحاول مرة أخرى.");
    } finally {
      button.disabled = false;
      button.textContent = "حفظ شهادة الشكر والتقدير كصورة";
    }
  });
  const hero = document.querySelector(".hero-character");
  if (hero) {
    const poses = ["pose-guard", "pose-lean", "pose-proud"];
    let poseIndex = 0;
    window.setInterval(() => { hero.classList.remove(...poses); poseIndex = (poseIndex + 1) % poses.length; hero.classList.add(poses[poseIndex]); }, 9000);
    hero.addEventListener("click", () => { hero.classList.toggle("pose-wave"); if (window.comicSound) window.comicSound("pop"); });
  }
  render();
})();
const ART_PANEL_COUNT = 120;
const ART_OWNER_TOKEN_KEY = "community-art-owner-token-v1";
function getArtOwnerToken(){
  try {
    let token=localStorage.getItem(ART_OWNER_TOKEN_KEY);
    if(!token){
      token=window.crypto?.randomUUID?.() || (window.crypto?.getRandomValues
        ? Array.from(window.crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("")
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(ART_OWNER_TOKEN_KEY,token);
    }
    return token;
  } catch(e) { return ""; }
}
const artOwnerToken=getArtOwnerToken();
let ownedArtworkIds=new Set(), artworkRows=[];
const communityBoard=$("art-board");
let pendingRevealPanel=0;
let communityPreviewOverlay=null;
let communityBoardPlaceholder=null;
function closeCommunityBoardPreview(){
  if(!communityPreviewOverlay)return;
  if(communityBoardPlaceholder?.parentNode){
    communityBoardPlaceholder.parentNode.insertBefore(communityBoard,communityBoardPlaceholder);
    communityBoardPlaceholder.remove();
  }
  communityPreviewOverlay.remove();
  communityPreviewOverlay=null;
  communityBoardPlaceholder=null;
  communityBoard?.classList.remove("board-expanded","board-image-preview");
  if(communityBoard)communityBoard.style.zoom="";
  document.body.classList.remove("community-board-open");
  const button=$("art-board-fullscreen");
  if(button){button.setAttribute("aria-pressed","false");button.textContent="⛶ تكبير الصورة كاملة";button.setAttribute("aria-label","تكبير الصورة الجماعية كاملة");}
}
function setCommunityBoardPreview(enabled){
  if(!communityBoard)return;
  if(!enabled){closeCommunityBoardPreview();return;}
  if(communityPreviewOverlay)return;
  const button=$("art-board-fullscreen");
  communityBoardPlaceholder=document.createComment("community-board-position");
  communityBoard.parentNode.insertBefore(communityBoardPlaceholder,communityBoard);
  communityPreviewOverlay=document.createElement("div");
  communityPreviewOverlay.className="comic-preview-overlay";
  communityPreviewOverlay.setAttribute("role","dialog");
  communityPreviewOverlay.setAttribute("aria-modal","true");
  communityPreviewOverlay.setAttribute("aria-label","عرض الصورة الجماعية كاملة");
  const header=document.createElement("div");
  header.className="comic-preview-header";
  const heading=document.createElement("div");
  heading.className="comic-preview-heading";
  const title=document.createElement("strong");
  title.textContent="الصورة الجماعية";
  const summary=document.createElement("small");
  summary.className="comic-preview-summary";
  const discovered=artworkRows.length;
  summary.textContent=`${ar(discovered)} من ١٢٠ مربعًا مكتشفًا · عرض جميع المربعات`;
  heading.append(title,summary);
  const close=document.createElement("button");
  close.type="button";close.className="comic-preview-close";close.textContent="×";close.setAttribute("aria-label","إغلاق عرض الصورة");
  close.addEventListener("click",closeCommunityBoardPreview);
  header.append(heading,close);
  const stage=document.createElement("div");
  stage.className="comic-preview-stage";
  const zoomControls=document.createElement("div");
  zoomControls.className="comic-preview-zoom";
  zoomControls.setAttribute("aria-label","أدوات تكبير لوحة الكوميك");
  const zoomOut=document.createElement("button");
  zoomOut.type="button";zoomOut.className="comic-zoom-btn";zoomOut.textContent="−";zoomOut.setAttribute("aria-label","تصغير اللوحة");
  const zoomValue=document.createElement("span");
  zoomValue.className="comic-zoom-value";zoomValue.textContent="100%";
  const zoomIn=document.createElement("button");
  zoomIn.type="button";zoomIn.className="comic-zoom-btn";zoomIn.textContent="+";zoomIn.setAttribute("aria-label","تكبير اللوحة");
  const zoomFit=document.createElement("button");
  zoomFit.type="button";zoomFit.className="comic-zoom-fit";zoomFit.textContent="ملاءمة";zoomFit.setAttribute("aria-label","إظهار اللوحة كاملة");
  let boardZoom=1;
  const applyBoardZoom=()=>{communityBoard.style.zoom=String(boardZoom);zoomValue.textContent=`${Math.round(boardZoom*100)}%`;zoomOut.disabled=boardZoom<=1;zoomIn.disabled=boardZoom>=2.5;};
  zoomOut.addEventListener("click",()=>{boardZoom=Math.max(1,+(boardZoom-.2).toFixed(2));applyBoardZoom();});
  zoomIn.addEventListener("click",()=>{boardZoom=Math.min(2.5,+(boardZoom+.2).toFixed(2));applyBoardZoom();});
  zoomFit.addEventListener("click",()=>{boardZoom=1;applyBoardZoom();stage.scrollTo({top:0,left:0,behavior:"smooth"});});
  zoomControls.append(zoomOut,zoomValue,zoomIn,zoomFit);
  stage.append(communityBoard);
  communityPreviewOverlay.append(header,zoomControls,stage);
  applyBoardZoom();
  communityPreviewOverlay.addEventListener("click",event=>{if(event.target===communityPreviewOverlay)closeCommunityBoardPreview();});
  document.body.append(communityPreviewOverlay);
  communityBoard.classList.add("board-expanded","board-image-preview");
  document.body.classList.add("community-board-open");
  if(button){button.setAttribute("aria-pressed","true");button.textContent="× إغلاق عرض الصورة";button.setAttribute("aria-label","إغلاق عرض الصورة المكبرة");}
  close.focus({preventScroll:true});
}
$("art-board-fullscreen")?.addEventListener("click",()=>setCommunityBoardPreview(!communityPreviewOverlay));
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&communityPreviewOverlay)closeCommunityBoardPreview();
});
async function loadArtwork(){
  const root=$("art-board");if(!root||!supabaseClient)return;
  if(getPlayerName() && artOwnerToken){
    const registration=await supabaseClient.rpc("register_event_participant",{p_player_name:getPlayerName(),p_owner_token:artOwnerToken});
    if(registration.error){root.textContent="تعذر التحقق من اسم المشاركة. تأكد من تطبيق تحديث قاعدة البيانات ثم أعد تحميل الصفحة.";console.error(registration.error);return;}
    if(!registration.data?.success){root.textContent=registration.data?.reason==="NAME_TAKEN"?"هذا الاسم مستخدم بالفعل من مشارك آخر. اختر اسمًا مختلفًا.":registration.data?.reason==="CAPACITY_FULL"?"اكتمل عدد المشاركين (١٢٠ مشاركًا).":"تعذر اعتماد اسم المشاركة. تحقق من بيانات التسجيل ثم أعد المحاولة.";return;}
  }
  const {data,error}=await supabaseClient.from("community_artworks").select("id,panel_number,player_name,image_data,created_at").order("panel_number",{ascending:true});
  if(error){root.textContent="تعذر تحميل الصورة الجماعية. تحقق من اتصال قاعدة البيانات.";console.error(error);return;}
  artworkRows=data||[];ownedArtworkIds=new Set();
  if(artOwnerToken){const owned=await supabaseClient.rpc("get_owned_community_artwork_ids",{p_owner_token:artOwnerToken});if(!owned.error)ownedArtworkIds=new Set((owned.data||[]).map(x=>String(typeof x==="object"?x.id:x)));}
  root.innerHTML="";
  const countLabel=document.querySelector("#community-art .count"),byPanel=new Map(artworkRows.map(a=>[Number(a.panel_number),a]));
  if(countLabel)countLabel.textContent=`${ar(artworkRows.length)} / ١٢٠ مربعًا مكتشفًا`;
  for(let n=1;n<=ART_PANEL_COUNT;n++){
    const a=byPanel.get(n),tile=document.createElement("button"),row=Math.floor((n-1)/12),col=(n-1)%12;
    tile.type="button";tile.className=`comic-panel-tile${a?" occupied revealed":""}${a&&ownedArtworkIds.has(String(a.id))?" own-artwork":""}`;
    tile.setAttribute("aria-label",a?`المربع ${n} كشفه ${a.player_name}`:`المربع ${n} لم يُكشف بعد`);
    if(a){const comicImageUrl=new URL("./assets/community-comic.png",document.baseURI).href;tile.style.setProperty("background-image",`url("${comicImageUrl}")`,"important");tile.style.setProperty("background-size","1200% 1000%","important");tile.style.setProperty("background-repeat","no-repeat","important");tile.style.setProperty("background-position",`${col*100/11}% ${row*100/9}%`);const owner=document.createElement("b");owner.className="panel-owner";owner.textContent=a.player_name;tile.append(owner);if(Number(pendingRevealPanel)===n){tile.classList.add("reveal-animate");const pow=document.createElement("span");pow.className="comic-pow";pow.textContent="POW!";pow.setAttribute("aria-hidden","true");tile.append(pow);pendingRevealPanel=0;}}
    else{const num=document.createElement("span");num.className="panel-number";num.textContent=ar(n);tile.append(num);const plus=document.createElement("span");plus.className="panel-plus";plus.textContent="+";tile.append(plus);}
    tile.addEventListener("click",async()=>{
      if(a)return;
      const name=getPlayerName();if(!name){showIdentityGate();return;}
      if(ownedArtworkIds.size>=1){const ownRow=artworkRows.find(x=>ownedArtworkIds.has(String(x.id)));toast(ownRow?`لقد كشفت المربع ${ar(ownRow.panel_number)} بالفعل. يسمح بمربع واحد لكل مشارك.`:"يسمح بمربع واحد لكل مشارك.");return;}
      tile.disabled=true;
      const {data: registration,error: registrationError}=await supabaseClient.rpc("register_event_participant",{p_player_name:name,p_owner_token:artOwnerToken});
      if(registrationError||!registration?.success){tile.disabled=false;toast(registration?.reason==="NAME_TAKEN"?"هذا الاسم مستخدم بالفعل.":registration?.reason==="CAPACITY_FULL"?"اكتمل عدد المشاركين (١٢٠ مشاركًا).":"تعذر التحقق من الاسم. حاول مجددًا.");return;}
      const {error: insertError}=await supabaseClient.from("community_artworks").insert({panel_number:n,player_name:name,image_data:"comic-reveal",owner_token:artOwnerToken});
      if(insertError){tile.disabled=false;toast(insertError.code==="23505"?"سبق أن كُشف هذا المربع. اختر مربعًا آخر.":"تعذر كشف المربع. حاول مجددًا.");return;}
      pendingRevealPanel=n;toast("تم كشف جزء من الصورة! شكرًا لمشاركتك.");await loadArtwork();
    });
    root.append(tile);
  }
}

async function renderAdminArt(){const root=$("admin-art-list");if(!root||!supabaseClient)return;const {data,error}=await supabaseClient.from("community_artworks").select("id,panel_number,player_name,created_at").order("panel_number");if(error){root.textContent="تعذر تحميل إدارة الصورة الجماعية.";return;}root.innerHTML="";(data||[]).forEach(a=>{const row=document.createElement("div");row.className="admin-managed-row";const label=document.createElement("span");label.textContent=`المربع ${ar(a.panel_number)} · ${a.player_name}`;const del=document.createElement("button");del.className="small-btn danger";del.textContent="إخفاء المربع";del.onclick=async()=>{if(!confirm(`إخفاء المربع ${a.panel_number} من الصورة؟`))return;const {error}=await supabaseClient.from("community_artworks").delete().eq("id",a.id);if(error)toast("تعذر إخفاء المربع");else{toast("تم إخفاء المربع");renderAdminArt();loadArtwork();}};row.append(label,del);root.append(row);});if(!data?.length)root.textContent="لم تُكشف أي مربعات بعد.";}

let shopRows=[];
let selectedShopImageFile=null;
function setShopImagePreview(url){
  const wrap=$("shop-image-preview-wrap"),img=$("shop-image-preview");
  if(!wrap||!img)return;
  if(url){img.src=url;wrap.classList.remove("hidden");}else{img.removeAttribute("src");wrap.classList.add("hidden");}
}
function selectShopImage(file){
  if(!file)return;
  if(!file.type.startsWith("image/")){ $("shop-admin-status").textContent="يرجى اختيار ملف صورة صالح.";return; }
  if(file.size>5*1024*1024){ $("shop-admin-status").textContent="حجم الصورة يتجاوز 5 ميجابايت. اختر صورة أصغر.";return; }
  selectedShopImageFile=file;
  $("shop-edit-image").value="";
  setShopImagePreview(URL.createObjectURL(file));
  $("shop-admin-status").textContent="تم اختيار الصورة. ستُرفع عند حفظ الغرض.";
}
$("shop-camera-btn")?.addEventListener("click",()=>$("shop-camera-input").click());
$("shop-gallery-btn")?.addEventListener("click",()=>$("shop-gallery-input").click());
$("shop-camera-input")?.addEventListener("change",e=>{selectShopImage(e.target.files?.[0]);e.target.value="";});
$("shop-gallery-input")?.addEventListener("change",e=>{selectShopImage(e.target.files?.[0]);e.target.value="";});
$("shop-image-clear")?.addEventListener("click",()=>{selectedShopImageFile=null;$("shop-edit-image").value="";setShopImagePreview(null);});
async function uploadShopImage(file){
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const path=`items/${Date.now()}-${Math.random().toString(36).slice(2,10)}.${ext}`;
  const {error}=await supabaseClient.storage.from("reward-shop-images").upload(path,file,{contentType:file.type,upsert:false,cacheControl:"3600"});
  if(error)throw error;
  const {data}=supabaseClient.storage.from("reward-shop-images").getPublicUrl(path);
  return data.publicUrl;
}
function closeShopReceipt(){$("shop-receipt-modal")?.classList.add("hidden");}
function showShopReceipt(data,playerName,item){
  const redemptionId=data.redemption_id??data.purchase_id??`T${Date.now()}`;
  $("receipt-number").textContent=`INV-${String(redemptionId).padStart(6,"0")}`;
  $("receipt-player").textContent=playerName;
  $("receipt-item").textContent=data.item_name||item.name;
  $("receipt-points").textContent=`${ar(Number(data.points_spent??item.price))} نقطة`;
  $("receipt-balance").textContent=`${ar(Number(data.remaining_points??0))} نقطة`;
  const purchasedAt=data.purchased_at?new Date(data.purchased_at):new Date();
  $("receipt-date").textContent=new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Riyadh"}).format(purchasedAt);
  $("shop-receipt-modal").classList.remove("hidden");
}
$("shop-receipt-close")?.addEventListener("click",closeShopReceipt);
$("shop-receipt-done")?.addEventListener("click",closeShopReceipt);
$("shop-receipt-modal")?.addEventListener("click",e=>{if(e.target.id==="shop-receipt-modal")closeShopReceipt();});
$("shop-receipt-print")?.addEventListener("click",()=>{
  const paper=$("shop-receipt-paper");if(!paper)return;
  const win=window.open("","_blank","width=720,height=800");
  if(!win){toast("اسمح بالنوافذ المنبثقة لطباعة الفاتورة.");return;}
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة الشراء</title><style>body{font-family:Tahoma,Arial,sans-serif;padding:28px;color:#03252F} .receipt{max-width:560px;margin:auto;border:2px solid #08424D;padding:26px;border-radius:14px}h3{text-align:center;font-size:24px}.receipt-success-mark{text-align:center;font-size:38px;color:#B78F49}.receipt-subtitle,.receipt-footer{text-align:center;color:#60777B}.receipt-number-row,.receipt-line{display:flex;justify-content:space-between;gap:18px;padding:13px 0;border-bottom:1px solid #D9D0C3}.receipt-number-row{font-weight:bold;background:#F2E8D4;padding:14px}.receipt-divider{border-top:2px dashed #B78F49;margin:18px 0}.receipt-footer{margin-top:24px}</style></head><body><div class="receipt">${paper.innerHTML}</div><script>window.onload=()=>{window.print();};<\/script></body></html>`);
  win.document.close();
});
async function loadShop(){if(!supabaseClient)return;const {data,error}=await supabaseClient.from("reward_shop_items").select("id,name,description,price,stock,image_url").eq("active",true).order("created_at",{ascending:false});const root=$("shop-items");if(error){root.textContent="تعذر تحميل المتجر. تحقق من إعدادات قاعدة البيانات.";console.error(error);return;}shopRows=data||[];root.innerHTML="";const name=getPlayerName();let balance=0;if(name){const {data:stats}=await supabaseClient.from("event_leaderboard").select("total_score").eq("player_key",name.toLocaleLowerCase()).maybeSingle();balance=Number(stats?.total_score||0);}$("shop-balance").textContent=ar(balance);shopRows.forEach(item=>{const card=document.createElement("article");card.className="shop-item";const media=document.createElement("div");media.className="shop-item-media";if(item.image_url){const img=document.createElement("img");img.src=item.image_url;img.alt=item.name;media.append(img);}else{const placeholder=document.createElement("span");placeholder.textContent="✦";media.append(placeholder);}const ribbon=document.createElement("span");ribbon.className="shop-ribbon";ribbon.textContent=item.stock>0?`متوفر · ${ar(item.stock)}`:"نفد المخزون";media.append(ribbon);const body=document.createElement("div");body.className="shop-item-body";const title=document.createElement("h3");title.textContent=item.name;const desc=document.createElement("p");desc.textContent=item.description||"جائزة حصرية من متجر الفعالية.";const foot=document.createElement("div");foot.className="shop-item-foot";const price=document.createElement("b");price.className="shop-price";price.textContent=`${ar(item.price)} نقطة`;const buy=document.createElement("button");buy.className="primary shop-buy";buy.textContent="احصل عليها";buy.disabled=item.stock<1||balance<item.price||!name;buy.onclick=async()=>{if(!confirm(`شراء ${item.name} مقابل ${item.price} نقطة؟`))return;buy.disabled=true;buy.textContent="جارٍ الشراء...";const {data,error}=await supabaseClient.rpc("purchase_reward_item",{p_item_id:item.id,p_player_key:name.toLocaleLowerCase()});if(error){console.error("Reward purchase failed",error);const msg=String(error.message||"");const code=String(error.code||"");$("shop-status").textContent=msg.includes("INSUFFICIENT")?"رصيدك من النقاط لا يكفي.":msg.includes("OUT_OF_STOCK")?"عذرًا، نفدت الكمية.":msg.includes("ITEM_NOT_FOUND")?"هذا الغرض لم يعد متاحًا.":msg.includes("PLAYER_NOT_FOUND")?"لم يتم العثور على حساب النقاط لهذا الاسم.":`تعذر إتمام الشراء (${code||"خطأ"}). راجع تحديث قاعدة البيانات.`;buy.disabled=false;buy.textContent="إعادة المحاولة";return;}if(!data?.success){$("shop-status").textContent="لم يتم تأكيد عملية الشراء. حدّث الصفحة وحاول مجددًا.";buy.disabled=false;buy.textContent="إعادة المحاولة";return;}$("shop-status").textContent="تم الشراء بنجاح! صدرت فاتورتك ويمكنك طباعتها أو حفظها PDF.";toast("تم الشراء وإصدار الفاتورة");showShopReceipt(data,name,item);await loadShop();};foot.append(price,buy);body.append(title,desc,foot);card.append(media,body);root.append(card);});if(!shopRows.length)root.textContent="لا توجد أغراض متاحة حاليًا.";}
async function renderAdminShop(){const root=$("admin-shop-list");if(!root||!supabaseClient)return;const {data,error}=await supabaseClient.from("reward_shop_items").select("id,name,description,price,stock,image_url,active").order("created_at",{ascending:false});if(error){root.textContent="تعذر تحميل إدارة المتجر.";return;}root.innerHTML="";(data||[]).forEach(item=>{const row=document.createElement("div");row.className="admin-managed-row";const label=document.createElement("span");label.textContent=`${item.name} · ${item.price} نقطة · المخزون ${item.stock}`;const edit=document.createElement("button");edit.className="small-btn";edit.textContent="تعديل";edit.onclick=()=>{selectedShopImageFile=null;$("shop-edit-id").value=item.id;$("shop-edit-name").value=item.name;$("shop-edit-description").value=item.description||"";$("shop-edit-price").value=item.price;$("shop-edit-stock").value=item.stock;$("shop-edit-image").value=item.image_url||"";setShopImagePreview(item.image_url||null);$("shop-edit-name").focus();};const del=document.createElement("button");del.className="small-btn danger";del.textContent="حذف";del.onclick=async()=>{if(!confirm("حذف هذا الغرض من المتجر؟"))return;const {error}=await supabaseClient.from("reward_shop_items").delete().eq("id",item.id);if(error)toast("تعذر حذف الغرض");else{toast("تم حذف الغرض");renderAdminShop();loadShop();}};row.append(label,edit,del);root.append(row);});}
$("shop-save")?.addEventListener("click",async()=>{const id=$("shop-edit-id").value;const button=$("shop-save");const payload={name:$("shop-edit-name").value.trim(),description:$("shop-edit-description").value.trim(),price:Number($("shop-edit-price").value),stock:Number($("shop-edit-stock").value),image_url:$("shop-edit-image").value.trim()||null,active:true};if(!payload.name||!Number.isInteger(payload.price)||payload.price<1||!Number.isInteger(payload.stock)||payload.stock<0){$("shop-admin-status").textContent="أدخل اسمًا وسعرًا صحيحًا وكمية غير سالبة.";return;}if(!supabaseClient){$("shop-admin-status").textContent="تعذر الاتصال بقاعدة البيانات.";return;}button.disabled=true;try{if(selectedShopImageFile){$("shop-admin-status").textContent="جارٍ رفع الصورة...";payload.image_url=await uploadShopImage(selectedShopImageFile);}const q=id?supabaseClient.from("reward_shop_items").update(payload).eq("id",id):supabaseClient.from("reward_shop_items").insert(payload);const {error}=await q;if(error)throw error;$("shop-admin-status").textContent="تم حفظ الغرض وصورته بنجاح.";$("shop-cancel").click();renderAdminShop();loadShop();}catch(error){console.error(error);$("shop-admin-status").textContent=`تعذر الحفظ: ${error.message||"تحقق من صلاحيات Storage وتحديث SQL."}`;}finally{button.disabled=false;}});
$("shop-cancel")?.addEventListener("click",()=>{["shop-edit-id","shop-edit-name","shop-edit-description","shop-edit-image"].forEach(id=>$(id).value="");$("shop-edit-price").value=50;$("shop-edit-stock").value=1;selectedShopImageFile=null;setShopImagePreview(null);$("shop-admin-status").textContent="";});
let artworkRealtime=null,shopRealtime=null;
function startCommunityRealtime(){if(!supabaseClient)return;if(!artworkRealtime)artworkRealtime=supabaseClient.channel("community-art-live").on("postgres_changes",{event:"*",schema:"public",table:"community_artworks"},()=>loadArtwork()).subscribe((status)=>{});if(!shopRealtime)shopRealtime=supabaseClient.channel("reward-shop-live").on("postgres_changes",{event:"*",schema:"public",table:"reward_shop_items"},()=>loadShop()).subscribe();}
const originalShowAdmin = showAdmin;
showAdmin = async function(session){await originalShowAdmin(session);if(session && !$("admin-view").classList.contains("hidden")){renderAdminArt();renderAdminShop();}};
const originalRememberPlayerName = rememberPlayerName;
rememberPlayerName = function(name){originalRememberPlayerName(name);loadShop();};
loadArtwork();loadShop();startCommunityRealtime();

})();
