(() => {
  const state = { users: [], filter: "", status: "all", plan: "all", catalogPlans: [] };
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const fmtDate = v => v ? new Date(v).toLocaleDateString() : "—";
  const fmtDateTime = v => v ? new Date(v).toLocaleString() : "—";

  async function sessionToken() {
    if (!window.supabaseClient) throw new Error("Supabase is not initialized.");
    const { data, error } = await window.supabaseClient.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Admin session expired. Please sign in again.");
    return data.session.access_token;
  }

  async function api(action, body = {}) {
    const token = await sessionToken();
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + token },
      body: JSON.stringify({ action, ...body })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Admin request failed.");
    return payload;
  }

  function badge(status) {
    const cls = status === "active" ? "active" : status === "expired" ? "expired" : "free";
    return '<span class="badge ' + cls + '">' + esc(status.toUpperCase()) + "</span>";
  }

  function matches(u) {
    const q = state.filter.toLowerCase();
    const text = !q || u.email.toLowerCase().includes(q) || String(u.name || "").toLowerCase().includes(q);
    let status = true;
    if (state.status === "active") status = u.mcq_active;
    if (state.status === "expired") status = u.mcq_expired;
    if (state.status === "free") status = !u.mcq_active;
    if (state.status === "ocr") status = u.ocr_active;
    let plan = true;
    if (state.plan === "pro") plan = u.mcq_tier === "pro";
    if (state.plan === "free") plan = u.mcq_tier === "free";
    return text && status && plan;
  }

  function renderStats() {
    const total = state.users.length;
    const active = state.users.filter(u => u.mcq_active).length;
    const expired = state.users.filter(u => u.mcq_expired).length;
    const ocr = state.users.filter(u => u.ocr_active).length;
    const pro = state.users.filter(u => u.mcq_active && u.mcq_tier === "pro").length;
    const free = Math.max(0, total - active);
    const usage = state.users.reduce((s,u) => s + (Number(u.ocr_used) || 0), 0);
    const limit = state.users.reduce((s,u) => s + (Number(u.ocr_limit) || 0), 0);

    $("statTotal").textContent = total;
    $("statActive").textContent = active;
    $("statOcr").textContent = ocr;
    $("statFree").textContent = free;
    $("statRegistrations").textContent = expired ? expired + " expired subscriber" + (expired === 1 ? "" : "s") : "No expired subscribers";
    $("statMcqShare").textContent = pro + " active Pro subscriber" + (pro === 1 ? "" : "s");
    $("statOcrUsage").textContent = limit ? usage + " / " + limit + " units this month" : "No OCR quota records";

    $("overviewPro").textContent = pro;
    $("overviewOcr").textContent = ocr;
    $("overviewActive").textContent = active;
    $("overviewProBar").style.width = (total ? Math.min(100, pro / total * 100) : 0) + "%";
    $("overviewOcrBar").style.width = (total ? Math.min(100, ocr / total * 100) : 0) + "%";
    $("overviewActiveBar").style.width = (total ? Math.min(100, active / total * 100) : 0) + "%";
  }

  function renderAnalytics() {
    const now = Date.now();
    const sevenDays = now - 7 * 86400000;
    const expiringLimit = now + 7 * 86400000;
    const recent = [...state.users].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0,5);
    const activity = [...state.users].filter(u => u.last_sign_in_at).sort((a,b) => new Date(b.last_sign_in_at) - new Date(a.last_sign_in_at)).slice(0,6);
    const new7 = state.users.filter(u => u.created_at && new Date(u.created_at).getTime() >= sevenDays).length;
    const expiring7 = state.users.filter(u => u.mcq_active && u.mcq_expires && new Date(u.mcq_expires).getTime() <= expiringLimit && new Date(u.mcq_expires).getTime() >= now).length;
    const expired = state.users.filter(u => u.mcq_expired).length;
    const ocrUsed = state.users.reduce((s,u) => s + (Number(u.ocr_used) || 0), 0);

    $("newUsers7").textContent = new7;
    $("expiring7").textContent = expiring7;
    $("expiredCount").textContent = expired;
    $("ocrUsedAnalytics").textContent = ocrUsed;
    $("analyticsStatus").textContent = "Updated " + new Date().toLocaleTimeString();

    $("recentRegistrations").innerHTML = recent.length ? recent.map(u =>
      '<div class="recent-item"><div><strong>' + esc(u.name || "—") + '</strong><small>' + esc(u.email) + '</small></div><div class="recent-meta">' + esc(fmtDateTime(u.created_at)) + '</div></div>'
    ).join("") : '<div class="recent-empty">No registration records.</div>';

    $("recentActivity").innerHTML = activity.length ? activity.map(u =>
      '<div class="recent-item"><div><strong>' + esc(u.name || "—") + '</strong><small>' + esc(u.email) + '</small></div><div class="recent-meta">' + esc(fmtDateTime(u.last_sign_in_at)) + '</div></div>'
    ).join("") : '<div class="recent-empty">No sign-in activity available.</div>';
  }

  function renderUsers() {
    const rows = state.users.filter(matches);
    $("userRows").innerHTML = rows.length ? rows.map(u => {
      const mcqStatus = u.mcq_active ? badge("active") : (u.mcq_expired ? badge("expired") : badge("free"));
      return '<tr>' +
        '<td><strong>' + esc(u.name || "—") + '</strong><small>' + esc(u.email) + '</small></td>' +
        '<td>' + mcqStatus + '</td>' +
        '<td>' + esc(u.mcq_tier || "—") + '</td>' +
        '<td>' + esc(fmtDate(u.mcq_expires)) + '</td>' +
        '<td>' + (u.ocr_active ? badge("active") : badge("free")) + '</td>' +
        '<td>' + esc((u.ocr_used ?? 0) + " / " + (u.ocr_limit ?? 0)) + '</td>' +
        '<td><button class="btn small" data-action="manage" data-id="' + esc(u.id) + '">Manage</button></td>' +
      '</tr>';
    }).join("") : '<tr><td colspan="7" class="empty">No users match the current filters.</td></tr>';
  }

  function renderRecords(data) {
    const ents = data.entitlements || [];
    const quotas = data.quotas || [];
    const parts = [];
    ents.forEach(e => {
      parts.push('<div class="record"><strong>' + esc(e.product_id) + '</strong> · ' +
        esc(e.tier || "—") + ' · ' + (e.is_active ? "active" : "inactive") +
        ' · valid until ' + esc(fmtDate(e.valid_until)) + '</div>');
    });
    quotas.forEach(q => {
      parts.push('<div class="record"><strong>' + esc(q.product_id) + '</strong> · ' +
        esc(q.feature_id || "quota") + ' · ' + esc(q.used_units ?? 0) + ' / ' +
        esc(q.unit_limit ?? 0) + ' · ' + esc(q.billing_cycle_month || "—") + '</div>');
    });
    $("detailRecords").innerHTML = parts.length ? parts.join("") : "No entitlement or quota records.";
  }

  function renderGenericCatalog(title, rows) {
    if (!rows || !rows.length) return '<div class="catalog-block"><strong>'+esc(title)+'</strong><div class="recent-empty">No records.</div></div>';
    const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))].slice(0,8);
    return '<div class="catalog-block"><div class="catalog-title"><strong>'+esc(title)+'</strong><span>'+rows.length+' record'+(rows.length===1?'':'s')+'</span></div>' +
      '<div class="catalog-table-wrap"><table class="catalog-table"><thead><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+
      rows.slice(0,30).map(r=>'<tr>'+keys.map(k=>'<td>'+esc(r[k]===null||r[k]===undefined?'—':typeof r[k]==='object'?JSON.stringify(r[k]):r[k])+'</td>').join('')+'</tr>').join('')+
      '</tbody></table></div></div>';
  }

  function planField(row, candidates) {
    const key=Object.keys(row||{}).find(k=>candidates.includes(k));
    return key ? row[key] : "";
  }

  function renderPlans(rows) {
    state.catalogPlans=rows||[];
    if(!rows||!rows.length)return '<div class="catalog-block"><strong>Plans</strong><div class="recent-empty">No plan records.</div></div>';
    return '<div class="catalog-block"><div class="catalog-title"><strong>Plans</strong><span>'+rows.length+' records · editable</span></div>'+
      '<div class="catalog-table-wrap"><table class="catalog-table"><thead><tr><th>Name</th><th>Price</th><th>Validity</th><th>ID</th><th></th></tr></thead><tbody>'+
      rows.map(r=>{
        const name=planField(r,["name","plan_name","title"]);
        const price=planField(r,["price","amount","monthly_price","price_monthly","unit_price","cost"]);
        const validity=planField(r,["validity_days","duration_days","days","duration","valid_days","period_days"]);
        return '<tr><td>'+esc(name||"—")+'</td><td>'+esc(price===""?"—":price)+'</td><td>'+esc(validity===""?"—":validity)+' days</td><td>'+esc(r.id||"—")+'</td><td><button class="btn small" data-action="edit-plan" data-id="'+esc(r.id)+'">Edit</button></td></tr>';
      }).join('')+
      '</tbody></table></div></div>';
  }

  async function loadCatalog() {
    $("catalogContent").innerHTML = '<div class="recent-empty">Loading catalog…</div>';
    try {
      const data=await api("catalog");
      $("catalogContent").innerHTML =
        renderGenericCatalog("Products",data.products)+
        renderPlans(data.plans)+
        renderGenericCatalog("Features",data.features)+
        renderGenericCatalog("Plan feature quotas",data.plan_feature_quotas);
    } catch(e) {
      $("catalogContent").innerHTML='<div class="recent-empty error">'+esc(e.message)+'</div>';
    }
  }

  function openPlanEdit(id) {
    const row=state.catalogPlans.find(x=>String(x.id)===String(id));
    if(!row)return;
    $("planEditId").value=row.id;
    $("planEditName").value=planField(row,["name","plan_name","title"]);
    $("planEditPrice").value=planField(row,["price","amount","monthly_price","price_monthly","unit_price","cost"]);
    $("planEditValidity").value=planField(row,["validity_days","duration_days","days","duration","valid_days","period_days"]);
    $("planStatus").textContent="";
    $("planStatus").className="modal-status";
    $("planModal").classList.remove("hidden");
  }

  async function savePlan() {
    const planId=$("planEditId").value;
    $("savePlanBtn").disabled=true;
    $("planStatus").textContent="Saving…";
    $("planStatus").className="modal-status";
    try{
      await api("update_plan",{planId,name:$("planEditName").value.trim(),price:Number($("planEditPrice").value),validityDays:Number($("planEditValidity").value)});
      $("planStatus").textContent="Plan updated successfully.";
      $("planStatus").className="modal-status success";
      await loadCatalog();
    }catch(e){
      $("planStatus").textContent=e.message;
      $("planStatus").className="modal-status error";
    }finally{$("savePlanBtn").disabled=false;}
  }

  async function loadActivity() {
    $("activityLog").innerHTML='<div class="recent-empty">Loading activity…</div>';
    try {
      const data=await api("get_activity_log",{limit:50});
      const rows=data.activities||[];
      $("activityLog").innerHTML=rows.length?rows.map(a=>
        '<div class="recent-item"><div><strong>'+esc(a.action)+'</strong><small>'+esc(a.target_email||a.target_user_id||"System")+'</small></div><div class="recent-meta">'+esc(fmtDateTime(a.created_at))+'</div></div>'
      ).join(""):'<div class="recent-empty">No admin activity recorded yet.</div>';
    } catch(e) {
      $("activityLog").innerHTML='<div class="recent-empty error">'+esc(e.message)+'</div>';
    }
  }

  async function loadHistory(id) {
    $("subscriptionHistory").textContent="Loading…";
    try {
      const data=await api("get_subscription_history",{userId:id});
      const rows=data.history||[];
      $("subscriptionHistory").innerHTML=rows.length?rows.map(h=>
        '<div class="record"><strong>'+esc(h.action)+'</strong> · '+esc(h.product_id)+' · '+esc(h.tier||"—")+
        ' · '+esc(fmtDateTime(h.created_at))+(h.valid_until?' · until '+esc(fmtDate(h.valid_until)):"")+
        (h.ocr_limit!==null&&h.ocr_limit!==undefined?' · OCR '+esc(h.ocr_limit):"")+
        (h.note?' · '+esc(h.note):"")+'</div>'
      ).join(""):'No subscription history yet.';
    } catch(e) {
      $("subscriptionHistory").textContent=e.message;
    }
  }

  async function loadDetail(id) {
    $("detailRecords").textContent = "Loading…";
    try {
      const data = await api("get_user_detail", { userId:id });
      const u = data.user;
      $("detailCreated").textContent = fmtDateTime(u.created_at);
      $("detailLastSignIn").textContent = fmtDateTime(u.last_sign_in_at);
      $("detailEmailStatus").textContent = u.email_confirmed ? "Confirmed" : "Not confirmed";
      $("detailAccountStatus").textContent = u.account_active === false ? "Disabled" : "Active";
      renderRecords(data);
    } catch (e) {
      $("detailRecords").textContent = e.message;
    }
  }

  function openManage(id) {
    const u = state.users.find(x => x.id === id);
    if (!u) return;
    $("manageUserId").value = u.id;
    $("manageEmail").textContent = u.email;
    $("manageName").textContent = u.name || "—";
    $("manageEmailInput").value = u.email || "";
    $("manageNameInput").value = u.name || "";
    $("managePasswordInput").value = "";
    $("planSelect").value = u.mcq_tier || "pro";
    $("daysInput").value = 30;
    $("ocrLimitInput").value = u.ocr_limit ?? 10;
    $("accountActiveSelect").value = u.account_active === false ? "false" : "true";
    $("manageStatus").textContent = "";
    $("manageStatus").className = "modal-status";
    $("manageModal").classList.remove("hidden");
    loadDetail(id);
    loadHistory(id);
  }

  async function loadUsers() {
    $("refreshBtn").disabled = true;
    $("refreshBtn").textContent = "Loading…";
    $("adminStatus").textContent = "Loading users…";
    $("adminStatus").className = "status";
    try {
      const data = await api("list_users");
      state.users = data.users || [];
      renderStats();
      renderUsers();
      renderAnalytics();
      loadCatalog();
      loadActivity();
      $("lastSync").textContent = "Synced " + new Date().toLocaleTimeString();
      $("adminStatus").textContent = state.users.length + " user" + (state.users.length === 1 ? "" : "s") + " loaded.";
      $("adminStatus").className = "status success";
    } catch (e) {
      $("adminStatus").textContent = e.message;
      $("adminStatus").className = "status error";
    } finally {
      $("refreshBtn").disabled = false;
      $("refreshBtn").textContent = "Refresh data";
    }
  }

  async function saveChanges() {
    const userId = $("manageUserId").value;
    const plan = $("planSelect").value;
    const days = Math.max(1, Number($("daysInput").value || 30));
    const ocrLimit = Math.max(0, Number($("ocrLimitInput").value || 0));
    const active = $("accountActiveSelect").value === "true";
    $("saveSubBtn").disabled = true;
    $("manageStatus").textContent = "Saving…";
    $("manageStatus").className = "modal-status";
    try {
      await api("update_user", {
        userId,
        email: $("manageEmailInput").value.trim(),
        name: $("manageNameInput").value.trim(),
        password: $("managePasswordInput").value
      });
      await api("set_subscription", { userId, plan, days, ocrLimit });
      await api("set_account_status", { userId, active });
      $("manageStatus").textContent = "Changes saved successfully.";
      $("manageStatus").className = "modal-status success";
      await loadUsers();
      await loadDetail(userId);
    } catch (e) {
      $("manageStatus").textContent = e.message;
      $("manageStatus").className = "modal-status error";
    } finally {
      $("saveSubBtn").disabled = false;
    }
  }

  async function revokeSubscription() {
    const userId = $("manageUserId").value;
    if (!userId || !confirm("Revoke MCQ subscription for this user?")) return;
    $("manageStatus").textContent = "Revoking…";
    try {
      await api("revoke_subscription", { userId });
      $("manageStatus").textContent = "MCQ subscription revoked.";
      $("manageStatus").className = "modal-status success";
      await loadUsers();
      await loadDetail(userId);
    } catch (e) {
      $("manageStatus").textContent = e.message;
      $("manageStatus").className = "modal-status error";
    }
  }

  async function createSubscriber() {
    const name=$("newUserName").value.trim(), email=$("newUserEmail").value.trim(), password=$("newUserPassword").value;
    const plan=$("newUserPlan").value, days=Math.max(1,Number($("newUserDays").value||30)), ocrLimit=Math.max(0,Number($("newUserOcr").value||0));
    $("createSubscriberBtn").disabled=true;
    $("addSubscriberStatus").textContent="Creating subscriber…";
    $("addSubscriberStatus").className="modal-status";
    try{
      const created=await api("create_subscriber",{name,email,password});
      await api("set_subscription",{userId:created.user.id,plan,days,ocrLimit});
      $("addSubscriberStatus").textContent="Subscriber created successfully.";
      $("addSubscriberStatus").className="modal-status success";
      await loadUsers();
      setTimeout(()=>{$("addSubscriberModal").classList.add("hidden");},700);
    }catch(e){
      $("addSubscriberStatus").textContent=e.message;
      $("addSubscriberStatus").className="modal-status error";
    }finally{$("createSubscriberBtn").disabled=false;}
  }

  async function resetOcr() {
    const userId = $("manageUserId").value;
    if (!userId || !confirm("Reset this user's OCR monthly usage to 0?")) return;
    $("manageStatus").textContent = "Resetting…";
    try {
      await api("reset_ocr", { userId });
      $("manageStatus").textContent = "OCR usage reset.";
      $("manageStatus").className = "modal-status success";
      await loadUsers();
      await loadDetail(userId);
    } catch (e) {
      $("manageStatus").textContent = e.message;
      $("manageStatus").className = "modal-status error";
    }
  }

  function setQuick(kind) {
    state.status = kind;
    $("statusFilter").value = kind;
    if (kind === "all") {
      state.plan = "all";
      $("planFilter").value = "all";
    }
    renderUsers();
  }

  async function boot() {
    try {
      const configResponse = await fetch("/api/config", { cache:"no-store" });
      const cfg = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || !cfg.url || !cfg.anonKey) throw new Error(cfg.error || "Supabase configuration is missing.");
      window.FOLIORA_SUPABASE_CONFIG = cfg;
      window.supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
      const { data } = await window.supabaseClient.auth.getSession();
      if (!data.session) {
        $("loginView").classList.remove("hidden");
        $("adminView").classList.add("hidden");
        return;
      }
      $("loginView").classList.add("hidden");
      $("adminView").classList.remove("hidden");
      await loadUsers();
    } catch (e) {
      $("loginError").textContent = e.message;
      $("loginView").classList.remove("hidden");
    }
  }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("loginError").textContent = "";
    try {
      const { error } = await window.supabaseClient.auth.signInWithPassword({
        email:$("email").value.trim(),
        password:$("password").value
      });
      if (error) throw error;
      $("loginView").classList.add("hidden");
      $("adminView").classList.remove("hidden");
      await loadUsers();
    } catch (e) {
      $("loginError").textContent = e.message;
    }
  });

  $("searchInput").addEventListener("input", e => { state.filter = e.target.value; renderUsers(); });
  $("statusFilter").addEventListener("change", e => { state.status = e.target.value; renderUsers(); });
  $("planFilter").addEventListener("change", e => { state.plan = e.target.value; renderUsers(); });
  $("refreshBtn").addEventListener("click", loadUsers);
  $("closeModal").addEventListener("click", () => $("manageModal").classList.add("hidden"));
  $("saveSubBtn").addEventListener("click", saveChanges);
  $("revokeBtn").addEventListener("click", revokeSubscription);
  $("resetOcrBtn").addEventListener("click", resetOcr);
  $("reloadDetailBtn").addEventListener("click", () => loadDetail($("manageUserId").value));
  $("reloadHistoryBtn").addEventListener("click", () => loadHistory($("manageUserId").value));
  $("reloadCatalogBtn").addEventListener("click", loadCatalog);
  $("reloadActivityBtn").addEventListener("click", loadActivity);
  $("addSubscriberBtn").addEventListener("click", () => {
    ["newUserName","newUserEmail","newUserPassword"].forEach(id => $(id).value="");
    $("newUserPlan").value="free"; $("newUserDays").value=30; $("newUserOcr").value=10;
    $("addSubscriberStatus").textContent=""; $("addSubscriberStatus").className="modal-status";
    $("addSubscriberModal").classList.remove("hidden");
  });
  $("createSubscriberBtn").addEventListener("click", createSubscriber);
  $("cancelAddSubscriber").addEventListener("click", () => $("addSubscriberModal").classList.add("hidden"));
  $("closeAddSubscriber").addEventListener("click", () => $("addSubscriberModal").classList.add("hidden"));
  $("savePlanBtn").addEventListener("click", savePlan);
  $("cancelPlanBtn").addEventListener("click", () => $("planModal").classList.add("hidden"));
  $("closePlanModal").addEventListener("click", () => $("planModal").classList.add("hidden"));
  $("catalogContent").addEventListener("click", e => {
    const b=e.target.closest("[data-action=edit-plan]");
    if(b)openPlanEdit(b.dataset.id);
  });
  $("quickFilter").addEventListener("change", e => setQuick(e.target.value));
  $("userRows").addEventListener("click", e => {
    const b = e.target.closest("[data-action=manage]");
    if (b) openManage(b.dataset.id);
  });
  $("manageModal").addEventListener("click", e => {
    if (e.target === $("manageModal")) $("manageModal").classList.add("hidden");
  });
  $("logoutBtn").addEventListener("click", async () => {
    await window.supabaseClient.auth.signOut();
    location.reload();
  });
  window.addEventListener("DOMContentLoaded", boot);
})();