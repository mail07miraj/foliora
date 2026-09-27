(() => {
  const state = { users: [], filter: "", status: "all", plan: "all" };
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

  async function loadDetail(id) {
    $("detailRecords").textContent = "Loading…";
    try {
      const data = await api("get_user_detail", { userId:id });
      const u = data.user;
      $("detailCreated").textContent = fmtDateTime(u.created_at);
      $("detailLastSignIn").textContent = fmtDateTime(u.last_sign_in_at);
      $("detailEmailStatus").textContent = u.email_confirmed ? "Confirmed" : "Not confirmed";
      $("detailAccountStatus").textContent = u.banned_until ? "Banned" : "Active";
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
    $("planSelect").value = u.mcq_tier || "pro";
    $("daysInput").value = 30;
    $("ocrLimitInput").value = u.ocr_limit ?? 10;
    $("accountActiveSelect").value = u.account_active === false ? "false" : "true";
    $("manageStatus").textContent = "";
    $("manageStatus").className = "modal-status";
    $("manageModal").classList.remove("hidden");
    loadDetail(id);
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