(() => {
  const state = { users: [], filter: "" };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ action, ...body })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Admin request failed.");
    return payload;
  }

  function statusBadge(status) {
    const cls = status === "active" ? "active" : status === "expired" ? "expired" : "free";
    return '<span class="badge ' + cls + '">' + esc(status.toUpperCase()) + '</span>';
  }

  function renderStats() {
    const total = state.users.length;
    const active = state.users.filter(u => u.mcq_active).length;
    const ocr = state.users.filter(u => u.ocr_active).length;
    $("statTotal").textContent = total;
    $("statActive").textContent = active;
    $("statOcr").textContent = ocr;
    $("statFree").textContent = Math.max(0, total - active);
  }

  function renderUsers() {
    const q = state.filter.toLowerCase();
    const rows = state.users.filter(u =>
      !q || u.email.toLowerCase().includes(q) || String(u.name || "").toLowerCase().includes(q)
    );

    $("userRows").innerHTML = rows.length ? rows.map(u => `
      <tr>
        <td><strong>${esc(u.name || "—")}</strong><small>${esc(u.email)}</small></td>
        <td>${u.mcq_active ? statusBadge("active") : statusBadge("free")}</td>
        <td>${u.mcq_tier ? esc(u.mcq_tier) : "—"}</td>
        <td>${u.mcq_expires ? esc(new Date(u.mcq_expires).toLocaleDateString()) : "—"}</td>
        <td>${esc((u.ocr_used ?? 0) + " / " + (u.ocr_limit ?? 0))}</td>
        <td>
          <button class="btn small" data-action="manage" data-id="${esc(u.id)}">Manage</button>
        </td>
      </tr>`).join("") : '<tr><td colspan="6" class="empty">No users found.</td></tr>';
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
    $("manageModal").classList.remove("hidden");
  }

  async function loadUsers() {
    $("refreshBtn").disabled = true;
    $("refreshBtn").textContent = "Loading…";
    try {
      const data = await api("list_users");
      state.users = data.users || [];
      renderStats();
      renderUsers();
      $("lastSync").textContent = "Synced " + new Date().toLocaleTimeString();
    } catch (e) {
      $("adminStatus").textContent = e.message;
      $("adminStatus").className = "status error";
    } finally {
      $("refreshBtn").disabled = false;
      $("refreshBtn").textContent = "Refresh";
    }
  }

  async function saveSubscription() {
    const userId = $("manageUserId").value;
    const plan = $("planSelect").value;
    const days = Math.max(1, Number($("daysInput").value || 30));
    const ocrLimit = Math.max(0, Number($("ocrLimitInput").value || 0));
    $("saveSubBtn").disabled = true;
    try {
      await api("set_subscription", { userId, plan, days, ocrLimit });
      $("manageModal").classList.add("hidden");
      $("adminStatus").textContent = "Subscription updated.";
      $("adminStatus").className = "status success";
      await loadUsers();
    } catch (e) {
      $("adminStatus").textContent = e.message;
      $("adminStatus").className = "status error";
    } finally {
      $("saveSubBtn").disabled = false;
    }
  }

  async function revokeSubscription() {
    const userId = $("manageUserId").value;
    if (!userId || !confirm("Revoke MCQ subscription for this user?")) return;
    try {
      await api("revoke_subscription", { userId });
      $("manageModal").classList.add("hidden");
      await loadUsers();
    } catch (e) {
      $("adminStatus").textContent = e.message;
      $("adminStatus").className = "status error";
    }
  }

  async function resetOcr() {
    const userId = $("manageUserId").value;
    if (!userId || !confirm("Reset this user's OCR monthly usage to 0?")) return;
    try {
      await api("reset_ocr", { userId });
      $("manageModal").classList.add("hidden");
      await loadUsers();
    } catch (e) {
      $("adminStatus").textContent = e.message;
      $("adminStatus").className = "status error";
    }
  }

  async function boot() {
    const cfg = window.FOLIORA_SUPABASE_CONFIG;
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
  }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("loginError").textContent = "";
    try {
      const { error } = await window.supabaseClient.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
      });
      if (error) throw error;
      $("loginView").classList.add("hidden");
      $("adminView").classList.remove("hidden");
      await loadUsers();
    } catch (e) { $("loginError").textContent = e.message; }
  });

  $("refreshBtn").addEventListener("click", loadUsers);
  $("searchInput").addEventListener("input", e => { state.filter = e.target.value; renderUsers(); });
  $("closeModal").addEventListener("click", () => $("manageModal").classList.add("hidden"));
  $("saveSubBtn").addEventListener("click", saveSubscription);
  $("revokeBtn").addEventListener("click", revokeSubscription);
  $("resetOcrBtn").addEventListener("click", resetOcr);
  $("userRows").addEventListener("click", e => {
    const b = e.target.closest("[data-action=manage]");
    if (b) openManage(b.dataset.id);
  });
  $("logoutBtn").addEventListener("click", async () => {
    await window.supabaseClient.auth.signOut();
    location.reload();
  });

  window.addEventListener("DOMContentLoaded", boot);
})();