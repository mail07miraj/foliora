// ====================================================================
// FOLIORA ECOSYSTEM: CONFIGURATION & SUPABASE INITIALIZATION
// ====================================================================

const SUPABASE_CONFIG = {
    url: "https://dajfssubdipeqnmedwxo.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhamZzc3ViZGlwZXFubWVkd3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MTAxODEsImV4cCI6MjEwNDE4NjE4MX0.cGBFywbbksMXOX-uzhM0obEPDEyC31I64zQ9d-TBwrU"
};

let supabaseClient = null;

const FOLIORA_STATE = {
    user: {
        isLoggedIn: false,
        id: null,
        name: "",
        email: "",
        token: null
    },
    activeProduct: 'mcq',
    entitlements: {
        mcq: 'locked',     // নতুন ইউজারের জন্য locked থাকবে
        converter: 'free',  // সবসময় ফ্রি
        ocr: 'free'         // ফ্রি ট্রায়াল কোটা
    },
    workspace: {
        mcq: true,
        converter: true,
        ocr: true
    },
    ocrQuota: {
        used: 0,
        limit: 10
    }
};

function initSupabase() {
    const url = SUPABASE_CONFIG.url || localStorage.getItem('foliora_supabase_url');
    const key = SUPABASE_CONFIG.anonKey || localStorage.getItem('foliora_supabase_key');

    if (url && key && typeof window.supabase !== "undefined" && window.supabase.createClient) {
        try {
            supabaseClient = window.supabase.createClient(url, key);
        } catch (err) {
            console.error("Supabase Init Error:", err);
        }
    }
}

// --- REAL LIVE ENTITLEMENT & QUOTA FETCHING ---
async function refreshLiveEntitlements(notify = false) {
    if (!supabaseClient || !FOLIORA_STATE.user || !FOLIORA_STATE.user.isLoggedIn) return;

    try {
        const userId = FOLIORA_STATE.user.id;
        const currentMonth = new Date().toISOString().slice(0, 7);

        const { data: entRows, error: entError } = await supabaseClient
            .from('entitlements')
            .select('product_id, tier, is_active')
            .eq('user_id', userId);

        if (!entError && Array.isArray(entRows)) {
            let hasMcq = false;
            let hasOcr = false;
            entRows.forEach(row => {
                if (row.product_id === 'foliora-mcq' && row.is_active) {
                    FOLIORA_STATE.entitlements.mcq = row.tier || 'pro';
                    hasMcq = true;
                }
                if (row.product_id === 'foliora-ocr' && row.is_active) {
                    FOLIORA_STATE.entitlements.ocr = row.tier || 'free';
                    hasOcr = true;
                }
            });
            if (!hasMcq) FOLIORA_STATE.entitlements.mcq = 'locked';
            if (!hasOcr) FOLIORA_STATE.entitlements.ocr = 'locked';
        }

        const { data: quotaRows, error: quotaError } = await supabaseClient
            .from('usage_quotas')
            .select('used_units, unit_limit')
            .eq('user_id', userId)
            .eq('product_id', 'foliora-ocr')
            .eq('billing_cycle_month', currentMonth)
            .maybeSingle();

        if (!quotaError && quotaRows) {
            FOLIORA_STATE.ocrQuota.used = quotaRows.used_units;
            FOLIORA_STATE.ocrQuota.limit = quotaRows.unit_limit;
        }

        saveFolioraPersistedState();
        updateHeaderAccountUI();
        switchProduct(FOLIORA_STATE.activeProduct);
        if (notify) showStatus("Entitlements synced with Supabase!");
    } catch (err) {
        console.warn("Could not sync with Supabase:", err);
    }
}

// --- SESSION RESTORATION ---
async function checkLiveSession() {
    if (!supabaseClient) return;
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (session && session.user) {
            const u = session.user;
            FOLIORA_STATE.user = {
                isLoggedIn: true,
                id: u.id,
                name: u.user_metadata?.full_name || u.email.split('@')[0],
                email: u.email,
                token: session.access_token
            };
            await refreshLiveEntitlements();
        } else {
            FOLIORA_STATE.user.isLoggedIn = false;
            FOLIORA_STATE.entitlements.mcq = 'locked';
        }
        updateHeaderAccountUI();
        switchProduct(FOLIORA_STATE.activeProduct);
    } catch (err) {
        console.warn("Session check error:", err);
    }
}

// --- STRICT AUTHENTICATION (NO FAKE PRO OVERRIDE) ---
async function handleLiveSignIn(e) {
    e.preventDefault();
    const email = document.getElementById('authSignInEmail').value.trim();
    const password = document.getElementById('authSignInPassword').value.trim();

    // কানেকশন না থাকলে পুনরায় ইনিশিয়ালাইজ করার চেষ্টা করবে
    if (!supabaseClient) {
        initSupabase();
    }

    if (!supabaseClient) {
        showStatus("সুপাবেজ সংযোগ পাওয়া যায়নি। ইন্টারনেট সংযোগ চেক করুন।", true);
        return;
    }

    setLoading('btnSubmitSignIn', true);
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const u = data.user;
        FOLIORA_STATE.user = {
            isLoggedIn: true,
            id: u.id,
            name: u.user_metadata?.full_name || u.email.split('@')[0],
            email: u.email,
            token: data.session.access_token
        };
        
        FOLIORA_STATE.entitlements.mcq = 'locked';
        await refreshLiveEntitlements();
        closeAuthModal();
        showStatus(`স্বাগতম, ${FOLIORA_STATE.user.name}!`);
    } catch (err) {
        showStatus("সাইন ইন ব্যর্থ: " + (err.message || "ভুল ইমেইল বা পাসওয়ার্ড"), true);
    } finally {
        setLoading('btnSubmitSignIn', false);
    }
}

async function handleLiveSignUp(e) {
    e.preventDefault();
    const name = document.getElementById('authSignUpName').value.trim();
    const email = document.getElementById('authSignUpEmail').value.trim();
    const password = document.getElementById('authSignUpPassword').value.trim();

    if (!supabaseClient) {
        showStatus("সুপাবেজ সংযোগ পাওয়া যায়নি।", true);
        return;
    }

    setLoading('btnSubmitSignUp', true);
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } }
        });
        if (error) throw error;

        if (data.session && data.user) {
            const u = data.user;
            FOLIORA_STATE.user = {
                isLoggedIn: true,
                id: u.id,
                name: name,
                email: u.email,
                token: data.session.access_token
            };
            FOLIORA_STATE.entitlements.mcq = 'locked';
            FOLIORA_STATE.entitlements.ocr = 'free';

            await refreshLiveEntitlements();
            closeAuthModal();
            showStatus(`অ্যাকাউন্ট তৈরি হয়েছে! স্বাগতম, ${name}।`);
        } else {
            closeAuthModal();
            showStatus("রেজিস্ট্রেশন সফল হয়েছে! অনুগ্রহ করে সাইন ইন করুন।");
        }
    } catch (err) {
        showStatus("রেজিস্ট্রেশন ব্যর্থ: " + (err.message || "অজানা ত্রুটি"), true);
    } finally {
        setLoading('btnSubmitSignUp', false);
    }
}

async function handleLiveSignOut() {
    if (supabaseClient) {
        try { await supabaseClient.auth.signOut(); } catch (e) { }
    }
    FOLIORA_STATE.user = { isLoggedIn: false, id: null, name: "", email: "", token: null };
    FOLIORA_STATE.entitlements.mcq = 'locked';
    saveFolioraPersistedState();
    updateHeaderAccountUI();
    closeProfileModal();
    switchProduct(FOLIORA_STATE.activeProduct);
    showStatus("Signed out of Foliora.");
}

function loadFolioraPersistedState() {
    try {
        const savedEnt = localStorage.getItem('foliora_entitlements');
        if (savedEnt) FOLIORA_STATE.entitlements = JSON.parse(savedEnt);

        const savedWs = localStorage.getItem('foliora_workspace');
        if (savedWs) FOLIORA_STATE.workspace = JSON.parse(savedWs);

        const savedQuota = localStorage.getItem('foliora_ocr_quota');
        if (savedQuota) FOLIORA_STATE.ocrQuota = JSON.parse(savedQuota);
    } catch (e) { }
}

function saveFolioraPersistedState() {
    try {
        localStorage.setItem('foliora_entitlements', JSON.stringify(FOLIORA_STATE.entitlements));
        localStorage.setItem('foliora_workspace', JSON.stringify(FOLIORA_STATE.workspace));
        localStorage.setItem('foliora_ocr_quota', JSON.stringify(FOLIORA_STATE.ocrQuota));
    } catch (e) { }
}

function updateHeaderAccountUI() {
    const user = FOLIORA_STATE.user;
    const avatar = document.getElementById('userAvatarIcon');
    const nameEl = document.getElementById('userDisplayName');
    const tierBadge = document.getElementById('headerTierBadge');

    if (user && user.isLoggedIn) {
        const initial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
        avatar.textContent = initial;
        avatar.className = "w-4 h-4 rounded-full bg-indigo-500 text-[10px] font-bold flex items-center justify-center text-white";
        nameEl.textContent = user.name.split(' ')[0];
        
        if (FOLIORA_STATE.entitlements.mcq === 'pro') {
            tierBadge.textContent = "PRO";
            tierBadge.className = "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-indigo-500/30 text-indigo-300 border border-indigo-400/30";
        } else {
            tierBadge.textContent = "FREE";
            tierBadge.className = "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-700 text-slate-300 border border-slate-600";
        }
    } else {
        avatar.textContent = "?";
        avatar.className = "w-4 h-4 rounded-full bg-slate-600 text-[10px] font-bold flex items-center justify-center text-slate-300";
        nameEl.textContent = "Sign In";
        tierBadge.textContent = "GUEST";
        tierBadge.className = "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700";
    }
}

function handleAccountButtonClick() {
    if (FOLIORA_STATE.user && FOLIORA_STATE.user.isLoggedIn) {
        openProfileModal();
    } else {
        openAuthModal('signin');
    }
}

function openAuthModal(tab = 'signin') {
    switchAuthTab(tab);
    document.getElementById('modalAuth').classList.remove('hidden');
}

function closeAuthModal() {
    document.getElementById('modalAuth').classList.add('hidden');
}

function switchAuthTab(tab) {
    const isSignIn = tab === 'signin';
    document.getElementById('formSignIn').classList.toggle('hidden', !isSignIn);
    document.getElementById('formSignUp').classList.toggle('hidden', isSignIn);

    const tabSignIn = document.getElementById('authTabSignIn');
    const tabSignUp = document.getElementById('authTabSignUp');
    
    if (isSignIn) {
        tabSignIn.className = "flex-1 py-2.5 text-center text-indigo-600 border-b-2 border-indigo-600 bg-white transition";
        tabSignUp.className = "flex-1 py-2.5 text-center hover:text-slate-800 transition";
    } else {
        tabSignUp.className = "flex-1 py-2.5 text-center text-indigo-600 border-b-2 border-indigo-600 bg-white transition";
        tabSignIn.className = "flex-1 py-2.5 text-center hover:text-slate-800 transition";
    }
}

function continueAsGuest() {
    closeAuthModal();
    showStatus("Continuing in guest mode. Converter is fully usable.");
}

function openProfileModal() {
    const user = FOLIORA_STATE.user;
    document.getElementById('profileNameDisplay').textContent = user.name || "Foliora User";
    document.getElementById('profileEmailDisplay').textContent = user.email || "user@foliora.com";
    document.getElementById('profileAvatarBig').textContent = user.name ? user.name.charAt(0).toUpperCase() : 'U';
    
    const mcqBadge = document.getElementById('profileBadgeMcq');
    mcqBadge.textContent = FOLIORA_STATE.entitlements.mcq === 'pro' ? 'Pro Active' : 'Locked / Expired';
    mcqBadge.className = FOLIORA_STATE.entitlements.mcq === 'pro' 
        ? "text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800" 
        : "text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800";

    const ocrBadge = document.getElementById('profileBadgeOcr');
    ocrBadge.textContent = FOLIORA_STATE.entitlements.ocr === 'pro' ? 'Pro (500 pgs/mo)' : '10 pgs/mo (Trial)';
    
    document.getElementById('modalProfile').classList.remove('hidden');
}

function closeProfileModal() {
    document.getElementById('modalProfile').classList.add('hidden');
}

// --- PRICING MODAL & CHECKOUT ---
function isMobileCommerceRestricted() {
    try {
        const platform = Office?.context?.platform;
        return platform === "iOS" || platform === "Android";
    } catch (e) {
        return false;
    }
}

function applyMobileCommerceRestrictions() {
    if (!isMobileCommerceRestricted()) return;

    // Microsoft Marketplace mobile policy: don't expose purchase/up-sell UI on mobile.
    document.querySelectorAll('[data-paid-action]').forEach(el => { el.style.display = 'none'; });
    const mobileNote = document.getElementById('mobilePlanNote');
    if (mobileNote) mobileNote.classList.remove('hidden');
}

function openPricingModal() {
    if (isMobileCommerceRestricted()) {
        showStatus("Plan management is available on desktop Word or Word on the web.");
        return;
    }
    closeProfileModal();
    document.getElementById('modalPricing').classList.remove('hidden');
}

function closePricingModal() {
    document.getElementById('modalPricing').classList.add('hidden');
}

function handleLockAction(productId) {
    if (isMobileCommerceRestricted()) {
        showStatus("Plan management is available on desktop Word or Word on the web.");
        return;
    }
    if (!FOLIORA_STATE.user || !FOLIORA_STATE.user.isLoggedIn) {
        openAuthModal('signin');
    } else {
        openPricingModal();
    }
}

async function initiateCheckout(planId) {
    if (isMobileCommerceRestricted()) {
        showStatus("Plan management is available on desktop Word or Word on the web.");
        return;
    }
    if (!FOLIORA_STATE.user || !FOLIORA_STATE.user.isLoggedIn) {
        closePricingModal();
        openAuthModal('signin');
        showStatus("প্ল্যান আপগ্রেড করতে অনুগ্রহ করে প্রথমে সাইন ইন করুন।", true);
        return;
    }

    const userId = FOLIORA_STATE.user.id;
    const userEmail = encodeURIComponent(FOLIORA_STATE.user.email);
    
    const checkoutUrl = `https://foliora.com/checkout?user_id=${userId}&email=${userEmail}&plan=${planId}`;
    window.open(checkoutUrl, "_blank");

    closePricingModal();
    showStatus("পেমেন্ট সম্পন্ন হলে ওয়ার্ড-এ ফিরে আসুন, স্বয়ংক্রিয়ভাবে ফিচার আনলক হয়ে যাবে।");
}

window.addEventListener("focus", () => {
    if (FOLIORA_STATE.user && FOLIORA_STATE.user.isLoggedIn && supabaseClient) {
        refreshLiveEntitlements(false);
    }
});

function switchProduct(productId) {
    FOLIORA_STATE.activeProduct = productId;

    document.querySelectorAll('.product-nav-btn').forEach(btn => {
        btn.classList.remove('bg-white', 'text-indigo-700', 'border-indigo-600', 'shadow-xs');
        btn.classList.add('text-slate-500', 'border-transparent');
    });

    const activeNav = document.getElementById('pnav-' + productId);
    if (activeNav) {
        activeNav.classList.remove('text-slate-500', 'border-transparent');
        activeNav.classList.add('bg-white', 'text-indigo-700', 'border-indigo-600', 'shadow-xs');
    }

    document.querySelectorAll('.product-pane').forEach(p => p.classList.remove('active'));
    const activePane = document.getElementById('product-' + productId);
    if (activePane) activePane.classList.add('active');

    const isUserLoggedIn = FOLIORA_STATE.user && FOLIORA_STATE.user.isLoggedIn;
    const isMcqLocked = !isUserLoggedIn || FOLIORA_STATE.entitlements.mcq === 'locked';
    
    document.getElementById('lock-mcq').classList.toggle('hidden', !isMcqLocked);
    document.getElementById('content-mcq').classList.toggle('hidden', isMcqLocked);
    
    if (isMcqLocked) {
        document.getElementById('lockMcqReason').textContent = isUserLoggedIn 
            ? "আপনার অ্যাকাউন্টে বর্তমানে Foliora MCQ Studio-এর সক্রিয় লাইসেন্স নেই।"
            : "MCQ Studio ব্যবহার করতে অনুগ্রহ করে আপনার Foliora অ্যাকাউন্টে সাইন ইন করুন।";
        document.getElementById('lockMcqBtnText').textContent = isUserLoggedIn ? "Upgrade Plan" : "Sign In to Unlock";
    }

    const isOcrLocked = !isUserLoggedIn || FOLIORA_STATE.entitlements.ocr === 'locked' || FOLIORA_STATE.ocrQuota.used >= FOLIORA_STATE.ocrQuota.limit;
    document.getElementById('lock-ocr').classList.toggle('hidden', !isOcrLocked);
    document.getElementById('content-ocr').classList.toggle('hidden', isOcrLocked);
    if (isOcrLocked) {
        document.getElementById('lockOcrReason').textContent = isUserLoggedIn
            ? "আপনার এই মাসের ফ্রি OCR কোটা শেষ হয়ে গেছে। আনলিমিটেড কোটা পেতে প্ল্যান আপগ্রেড করুন।"
            : "AI Vision OCR ব্যবহার করতে অনুগ্রহ করে সাইন ইন করুন।";
        document.getElementById('lockOcrBtnText').textContent = isUserLoggedIn ? "Upgrade OCR Quota" : "Sign In to Unlock";
    }
    updateOcrQuotaDisplay();

    const helper = document.getElementById('helper-info');
    if (helper) helper.style.display = (productId === 'ocr') ? 'none' : 'flex';
}

function switchMcqSubtab(subtabId) {
    document.querySelectorAll('#product-mcq .subtab-content').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('mcq-subtab-' + subtabId);
    if (target) target.classList.add('active');

    const btnForm = document.getElementById('subtab-btn-formatting');
    const btnStudio = document.getElementById('subtab-btn-studio');
    
    if (subtabId === 'formatting') {
        btnForm.className = "flex-1 py-1.5 rounded-md bg-white text-blue-700 shadow-sm transition";
        btnStudio.className = "flex-1 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition";
    } else {
        btnStudio.className = "flex-1 py-1.5 rounded-md bg-white text-blue-700 shadow-sm transition";
        btnForm.className = "flex-1 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition";
    }
}

function switchConverterSubtab(subtabId) {
    document.querySelectorAll('#product-converter .subtab-content').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('converter-subtab-' + subtabId);
    if (target) target.classList.add('active');

    const btnSmart = document.getElementById('subtab-btn-smart-convert');
    const btnFix = document.getElementById('subtab-btn-font-fixer');
    
    if (subtabId === 'smart-convert') {
        btnSmart.className = "flex-1 py-1.5 rounded-md bg-white text-indigo-700 shadow-sm transition";
        btnFix.className = "flex-1 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition";
    } else {
        btnFix.className = "flex-1 py-1.5 rounded-md bg-white text-indigo-700 shadow-sm transition";
        btnSmart.className = "flex-1 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition";
    }
}

function updateOcrQuotaDisplay() {
    const { used, limit } = FOLIORA_STATE.ocrQuota;
    const textEl = document.getElementById('ocrQuotaText');
    const barEl = document.getElementById('ocrQuotaBar');
    
    if (textEl) textEl.textContent = `${used} /${limit} pages used`;
    if (barEl) {
        const pct = Math.min(100, Math.round((used / limit) * 100));
        barEl.style.width = pct + '%';
        barEl.className = pct >= 100 ? "bg-red-500 h-full rounded-full transition-all duration-300" : "bg-teal-400 h-full rounded-full transition-all duration-300";
    }
}

function openWorkspaceModal() {
    document.getElementById('wsCheckMcq').checked = FOLIORA_STATE.workspace.mcq;
    document.getElementById('wsCheckConverter').checked = FOLIORA_STATE.workspace.converter;
    document.getElementById('wsCheckOcr').checked = FOLIORA_STATE.workspace.ocr;
    document.getElementById('modalWorkspace').classList.remove('hidden');
}

function closeWorkspaceModal() {
    document.getElementById('modalWorkspace').classList.add('hidden');
}

function saveWorkspaceSettings() {
    const mcq = document.getElementById('wsCheckMcq').checked;
    const conv = document.getElementById('wsCheckConverter').checked;
    const ocr = document.getElementById('wsCheckOcr').checked;

    if (!mcq && !conv && !ocr) {
        showStatus("Please keep at least one tool visible in your workspace.", true);
        return;
    }

    FOLIORA_STATE.workspace.mcq = mcq;
    FOLIORA_STATE.workspace.converter = conv;
    FOLIORA_STATE.workspace.ocr = ocr;

    document.getElementById('pnav-mcq').style.display = mcq ? 'flex' : 'none';
    document.getElementById('pnav-converter').style.display = conv ? 'flex' : 'none';
    document.getElementById('pnav-ocr').style.display = ocr ? 'flex' : 'none';

    saveFolioraPersistedState();
    closeWorkspaceModal();

    if (!FOLIORA_STATE.workspace[FOLIORA_STATE.activeProduct]) {
        if (mcq) switchProduct('mcq');
        else if (conv) switchProduct('converter');
        else if (ocr) switchProduct('ocr');
    }
    showStatus("Workspace updated successfully!");
}

// ====================================================================
// CORE ENGINES: MCQ FORMATTER, PARSER, SHUFFLE, CONVERTER, OCR
// ====================================================================
const BENGALI_ALPHABET = "কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহড়ঢ়য়ৎ";
const BANGLA_DIGITS = {'0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯'};
const OPTION_ORDER = ["ক", "খ", "গ", "ঘ"];
const OPTION_EXPORT_MAP = {"ক":"K", "খ":"L", "গ":"M", "ঘ":"N"};
const ANSWER_EXPORT_MAP = {"ক":"P", "খ":"Q", "গ":"R", "ঘ":"S"};
const MCQ_DUPLICATE_STATE = { results: [], mcqs: [], selectedText: "" };
let currentVisionImageBase64 = null;
let currentVisionImageMime = null;

function toggleSettings(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
}

function showStatus(msg, isError = false) {
    const toast = document.getElementById("toast");
    const toastIcon = document.getElementById("toastIcon");
    document.getElementById("toastMsg").textContent = msg;
    
    if (isError) {
        toastIcon.className = "fas fa-exclamation-circle text-red-400 mr-2.5 text-base";
        toast.classList.replace("bg-slate-900", "bg-red-950");
    } else {
        toastIcon.className = "fas fa-check-circle text-green-400 mr-2.5 text-base";
        toast.classList.replace("bg-red-950", "bg-slate-900");
    }
    toast.classList.add("show");
    setTimeout(() => { toast.classList.remove("show"); }, 3500);
}

function setLoading(buttonId, isLoading) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    if (isLoading) {
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Processing...';
        btn.disabled = true;
        btn.classList.add('opacity-80', 'cursor-not-allowed');
    } else {
        btn.innerHTML = btn.dataset.originalHtml || 'Processing...';
        btn.disabled = false;
        btn.classList.remove('opacity-80', 'cursor-not-allowed');
    }
}

function toBanglaNumber(n) {
    return String(n).replace(/[0-9]/g, w => BANGLA_DIGITS[w]);
}

function normalizeAnswerLabel(label) {
    if (!label) return "";
    const clean = String(label).trim();
    const map = { 
        "A":"ক","B":"খ","C":"গ","D":"ঘ",
        "a":"ক","b":"খ","c":"গ","d":"ঘ",
        "K":"ক","L":"খ","M":"গ","N":"ঘ",
        "k":"ক","l":"খ","m":"গ","n":"ঘ", 
        "P":"ক","Q":"খ","R":"গ","S":"ঘ" 
    };
    return map[clean] || clean;
}

function getSequenceString(index, style) {
    if (style === "bn-alpha") return BENGALI_ALPHABET[index % BENGALI_ALPHABET.length] + ". ";
    return toBanglaNumber(index + 1) + ". ";
}

function getStandardOptionMarker(label, isUnicode) {
    const norm = normalizeAnswerLabel(label);
    if (isUnicode) return norm + ".";
    const map = { "ক": "K", "খ": "L", "গ": "M", "ঘ": "N" };
    return (map[norm] || norm) + ".";
}

function getStandardAnswerMarker(answer, isUnicode) {
    const norm = normalizeAnswerLabel(answer);
    if (isUnicode) return `উত্তর: ${norm}`;
    const map = { "ক": "K", "খ": "L", "গ": "M", "ঘ": "N" };
    return `DËi: ${map[norm] || norm}`;
}
function mcqCaptureAnswerFormat(rawAnswerLine, answerContent, markerMatch) {
    const raw = String(rawAnswerLine || "").trim();
    const content = String(answerContent || "").trim();
    if (!raw || !content || !markerMatch) return null;

    const marker = String(markerMatch[1] || "").trim();
    if (!marker) return null;

    const contentStart = raw.indexOf(content);
    const markerIndexInContent = markerMatch.index ?? content.indexOf(marker);
    const markerOffsetInMatch = markerMatch[0].indexOf(marker);
    const markerStart = contentStart >= 0 && markerIndexInContent >= 0
        ? contentStart + markerIndexInContent + Math.max(0, markerOffsetInMatch)
        : raw.indexOf(marker);

    if (markerStart < 0) return null;

    return {
        rawLine: raw,
        prefix: raw.slice(0, markerStart),
        marker: marker,
        suffix: raw.slice(markerStart + marker.length)
    };
}

function mcqBuildPreservedAnswerText(question, answer) {
    const format = question && question.answerFormat;
    const normalizedAnswer = normalizeAnswerLabel(answer);
    if (!format || !normalizedAnswer) return "";

    const originalMarker = String(format.marker || "");
    const upper = originalMarker.toUpperCase();
    let outputMarker = normalizedAnswer;

    if (["A","B","C","D"].includes(upper)) {
        outputMarker = {"ক":"A","খ":"B","গ":"C","ঘ":"D"}[normalizedAnswer];
    } else if (["K","L","M","N"].includes(upper)) {
        outputMarker = {"ক":"K","খ":"L","গ":"M","ঘ":"N"}[normalizedAnswer];
    } else if (["P","Q","R","S"].includes(upper)) {
        outputMarker = {"ক":"P","খ":"Q","গ":"R","ঘ":"S"}[normalizedAnswer];
    }

    return (format.prefix || "") + outputMarker + (format.suffix || "");
}


// --- PROVEN ROBUST BIJOY <-> UNICODE CONVERTER ENGINE ---
function convertUnicodeToBijoy(text) {
    if (!text) return "";
    let str = text;
    str = str.replace(/\u09AF\u09BC/g, 'য়').replace(/\u09A1\u09BC/g, 'ড়').replace(/\u09A2\u09BC/g, 'ঢ়');
    str = str.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/ো/g, 'ো').replace(/ৌ/g, 'ৌ');
    
    let cons = "কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহড়ঢ়য়ৎংঃঁ"; 
    str = str.replace(new RegExp("র\u09CD([" + cons + "](?:\u09CD[" + cons + "])*)", "g"), "$1©");
    str = str.replace(new RegExp("([" + cons + "](?:\u09CD[" + cons + "])*(?:©)?)(ি|ে|ৈ)", "g"), "$2$1");
    str = str.replace(/(^|[\s\(\[\{'"‘“\-])ে/g, "$1†").replace(/ে/g, "‡");

    const u2bJukta = {
        'ন্ট':'›U', 'প্ট':'Þ', 'ষ্ক':'®‹', 'স্কু':'¯‹z', 'ল্ক':'é', 'ল্গ':'ê', 'ল্ড':'ì', 'শ্চ':'ð', 'স্কৃ':'¯‹…', 'গ্ন':'Mœ',
        'গ্ব':'M¦', 'ভু':'fz', 'খ্ব':'L¡', 'ক্ক':'°', 'ক্ট':'±', 'ক্ত':'³', 'ক্ব':'K¡', 'ক্স':'·', 'ক্ষ':'¶', 'ক্ষ্ম':'¶g', 'ক্ষ্য':'¶¨', 'ক্ষু':'¶z',
        'জ্ঞ':'Á', 'ঙ্ক':'¼', 'ঙ্খ':'¼L', 'ঙ্গ':'½', 'ঙ্ঘ':'½N', 'ট্ট':'Æ', 'ঠ্ঠ':'V&V', 'ড্ড':'Ç', 'ণ্ট':'È', 'ণ্ঠ':'É', 'ণ্ড':'Ð', 'ন্ড':'Û',
        'ত্ত':'Ë', 'ত্থ':'Ì', 'ত্র':'Î', 'দ্দ':'Ï', 'দ্ধ':'×', 'দ্ব':'Ø', 'দ্ভ':'™¢', 'দ্ম':'Ù', 'ন্দ':'›`', 'ন্দ্র':'›`ª', 'ন্ধ':'Ü', 'ধ্রু':'aªæ', 'ন্ন':'bœ', 'ন্ব':'b¦', 'ন্ম':'b¥', 'ন্দ্র':'›`«', 'দ্র':'`ª',
        'ম্প':'¤ú', 'ম্ব':'¤^', 'ম্ম':'¤§', 'ম্ভ':'¤¢', 'ন্স':'Ý', 'ত্ম':'Z¥', 'ত্ন':'Zœ', 'ত্ম্য':'Z¥¨', 'স্ট':'÷', 'ষ্ট':'ó', 'ষ্ঠ':'ô', 'ষ্ণ':'ò', 'ষ্প':'®ú', 'ষ্ফ':'®ù', 'ষ্ম':'®§',
        'স্ক':'¯‹', 'স্খ':'¯Œ', 'স্থ':'¯’', 'স্ন':'mœ', 'স্প':'¯ú', 'স্ফ':'ù', 'স্ম':'¯§', 'স্ব':'¯^', 'স্ত':'¯Í', 'স্স':'m&m',
        'হ্ম':'þ', 'হু':'û', 'হৃ':'ü', 'হ্ন':'ý', 'হ্ব':'nŸ', 'প্ত':'ß', 'ব্দ':'ã', 'ব্ধ':'ä', 'ব্ব':'e&e', 'ব্জ':'e&R',
        'শ্র':'kÖ', 'ক্র':'µ', 'গ্র':'MÖ', 'প্র':'cÖ', 'ড্র':'Wª', 'ট্র':'Uª', 'ফ্র':'d«', 'ব্র':'eª',
        'ব্ল':'eø', 'ক্ল':'K¬', 'গ্ল':'Mø', 'প্ল':'cø', 'ফ্ল':'d¬', 'ম্ল':'¤ø', 'ম্ফ':'ç', 'শ্ল':'kø', 'স্ল':'mø', 'হ্ল':'n&j',
        'ঞ্চ':'Â', 'ঞ্ছ':'Ã', 'ঞ্জ':'Ä', 'রু':'iæ', 'রূ':'i~', 'শু':'ï', 'গু':'¸', 'ন্তু':'š‘', 'স্তু':'¯‘',
        'চ্চ':'”P', 'চ্ছ':'”Q', 'জ্জ':'¾', 'ঝ্ঝ':'S&S', 'দ্ঘ':'`&N', 'ন্ত':'šÍ', 'ন্থ':'š’', 'ল্প':'í', 'ল্ব':'j&e', 'ল্ম':'j&g', 'ল্ল':'jø', 'ল্ফ':'j&d', 'ল্ট':'ë',
        'ধ্ব':'aŸ', 'শ্ব':'k¦', 'ত্ব':'Z¡', 'থ্ব':'_¡', 'ম্ন':'gœ', 'শ্ম':'k&g', 'দ্য':'`¨', 'ন্ত্র':'š¿', 'ম্প্র':'¤cÖ', 'স্থ্য':'¯’¨', 'ষ্ট্র':'ó«', 
        'শ্ন':'kœ', 'ব্য':'e¨', 'স্ত্র':'¯¿', 'ত্ত্ব':'Ë¡', 'ন্দ্ব':'›Ø', 'প্ন':'cœ', 'ত্য':'Z¨', 'স্ক্র':'¯‹«', 'স্ট্র':'÷«', 'থ্র':'_«', 'প্প':'c&c', 'প্স':'c&m',
        'ঙ্ক্ষ':'¼¶', 'ঙ্ম':'O&g', 'গ্ধ':'\xBB', '্য':'¨', '্র':'«', '্':'&',
        'কু':'Kz', 'কূ':'K‚', 'চু':'Pz', 'চূ':'P‚', 'ঝু':'Sz', 'ঝূ':'S‚', 'তু':'Zz', 'তূ':'Z‚', 'ভূ':'f‚', 'কৃ':'K…', 'তৃ':'Z…', 'রূ':'iƒ',
        'ত্যু':'Zz¨', 'প্যু':'cz¨', 'ফ্যু':'dz¨', 'স্ফু':'ùz', 'ভ্যু':'fz¨', 'হ্যু':'n~¨', 'ক্যু':'Kz¨', 'গ্যু':'Mz¨', 'চ্যু':'Pz¨', 'জ্যু':'Rz¨', 'ড্যু':'Wz¨', 'দ্যু':'`z¨', 'ধ্যু':'az¨', 'ব্যু':'ez¨', 'ল্যু':'jz¨', 'শ্যু':'k~¨', 'ত্যূ':'Z‚¨'
    };
    let keys = Object.keys(u2bJukta).sort((a, b) => b.length - a.length);
    for (let k of keys) { str = str.split(k).join(u2bJukta[k]); }

    const map = {
        'অ':'A', 'আ':'Av', 'ই':'B', 'ঈ':'C', 'উ':'D', 'ঊ':'E', 'ঋ':'F', 'এ':'G', 'ঐ':'H', 'ও':'I', 'ঔ':'J', 
        'ক':'K', 'খ':'L', 'গ':'M', 'ঘ':'N', 'ঙ':'O', 'চ':'P', 'ছ':'Q', 'জ':'R', 'ঝ':'S', 'ঞ':'T', 
        'ট':'U', 'ঠ':'V', 'ড':'W', 'ঢ':'X', 'ণ':'Y', 'ত':'Z', 'থ':'_', 'দ':'`', 'ধ':'a', 'ন':'b', 
        'প':'c', 'ফ':'d', 'ব':'e', 'ভ':'f', 'ম':'g', 'য':'h', 'র':'i', 'ল':'j', 'শ':'k', 'ষ':'l', 
        'স':'m', 'হ':'n', 'ড়':'o', 'ঢ়':'p', 'য়':'q', 'ৎ':'r', 'ং':'s', 'ঃ':'t', 'ঁ':'u', 'া':'v', 
        'ি':'w', 'ী':'x', 'ু':'y', 'ূ':'~', 'ৃ':'„', 'ে':'‡', 'ৈ':'ˆ', 'ৗ':'Š', '।':'|', 
        '০':'0', '১':'1', '২':'2', '৩':'3', '৪':'4', '৫':'5', '৬':'6', '৭':'৭', '৮':'8', '৯':'9', '©':'©' 
    };
    let out = "";
    for (let i = 0; i < str.length; i++) { out += map[str[i]] || str[i]; }
    return out;
}

function convertBijoyToUnicode(text) {
    if (!text) return "";
    // Keep literal symbols intact. In particular, "+" is a normal symbol
    // in mixed text and must never disappear during conversion.
    let str = text.replace(/[\u200B-\u200D\uFEFF]/g, "");

    const b2uJukta = {
        '›U':'ন্ট', 'Þ':'প্ট', '®‹':'ষ্ক', 'é':'ল্ক', 'ê':'ল্গ', 'ì':'ল্ড', 'ë':'ল্ট', 'ð':'শ্চ', '¯‹…':'স্কৃ',
        'M¦':'গ্ব', 'fz':'ভু', 'L¡':'খ্ব', '°':'ক্ক', '±':'ক্ট', '³':'ক্ত', 'K¡':'ক্ব',
        '·':'ক্স', '¯‹':'স্কু', '¶':'ক্ষ', '²':'ক্ষ্ম', '¶¨':'ক্ষ্য', '¶z':'ক্ষু',
        'Á':'জ্ঞ', '¼':'ঙ্ক', '¼L':'ঙ্খ', '½':'ঙ্গ', '½N':'ঙ্ঘ', 'Æ':'ট্ট', 'Ç':'ড্ড',
        'È':'ণ্ট', 'É':'ণ্ঠ', 'Ð':'ণ্ড', '\xDB':'ণ্ড',
        'Ë':'ত্ত', 'Ì':'ত্থ', 'Î':'ত্র', 'Ï':'দ্দ', '×':'দ্ধ', 'Ø':'দ্ব', '™¢':'দ্ভ', 'Ù':'দ্ম', '›`ª':'ন্দ্র',
        '›`':'ন্দ', 'Ü':'ন্ধ', 'aªæ':'ধ্রু', 'bœ':'ন্ন', 'b¦':'ন্ব', 'b¥':'ন্ম', '›`«':'ন্দ্র', '`ª':'দ্র',
        '¤ú':'ম্প', 'ç':'ম্ফ', '¤^':'ম্ব', '¤§':'ম্ম', '¤¢':'ম্ভ', 'Ý':'ন্স', 'Z¥':'ত্ম', 'Zœ':'ত্ন',
        'Z¥¨':'ত্ম্য', '÷':'স্ট', 'ó':'ষ্ট', 'ô':'ষ্ঠ', 'ò':'ষ্ণ', '®ú':'ষ্প', '®ù':'ষ্ফ',
        '®§':'ষ্ম', '¯‹':'স্ক', '¯Œ':'স্খ', '¯’':'স্থ', '¯œ':'স্ন', 'Mœ':'গ্ন', '¯ú':'স্প', 'ù':'স্ফ',
        '¯§':'স্ম', '¯^':'স্ব', '¯Í':'স্ত', 'm&m':'স্স',
        'þ':'হ্ম', 'û':'হু', 'ü':'হৃ', 'ý':'হ্ন', 'nŸ':'হ্ব', 'ß':'প্ত', 'ã':'ব্দ',
        'ä':'ব্ধ', 'e&e':'ব্ব', 'e&R':'ব্জ',
        'kÖ':'শ্র', 'µ':'ক্র', 'MÖ':'গ্র', 'cÖ':'প্র', 'Wª':'ড্র', 'Uª':'ট্র',
        'd«':'ফ্র', 'eª':'ব্র',
        'eø':'ব্ল', 'K¬':'ক্ল', 'Mø':'গ্ল', 'cø':'প্ল', 'd¬':'ফ্ল', '¤ø':'ম্ল',
        'kø':'শ্ল', 'mø':'স্ল', 'n&j':'হ্ল',
        '\xC2':'ঞ্চ', 'Â':'ঞ্চ', '\xC3':'ঞ্ছ', 'Ã':'ঞ্ছ', '\xC4':'ঞ্জ', 'Ä':'ঞ্জ',
        'iæ':'রু', 'i~':'রূ', 'ï':'শু', '¸':'গু', 'š‘':'ন্তু', '¯‘':'স্তু',
        '”P':'চ্চ', '\x94P':'চ্চ', '”Q':'চ্ছ', '\x94Q':'চ্ছ', '”':'চ্', '\x94':'চ্',
        '•':'চ্ছ', '¾':'জ্জ', 'S&S':'ঝ্ঝ', '`&N':'দ্ঘ', 'šÍ':'ন্ত', 'š’':'ন্থ',
        'í':'ল্প', 'j&e':'ল্ব', 'j&g':'ল্ম', 'jø':'ল্ল', 'j&d':'ল্ফ',
        'aŸ':'ধ্ব', 'k¦':'শ্ব', 'Z¡':'ত্ব', '_¡':'থ্ব', 'gœ':'ম্ন', 'k&g':'শ্ম',
        '`¨':'দ্য', 'š¿':'ন্ত্র', '¤cÖ':'ম্প্র',
        '¯’¨':'স্থ্য', 'ó«':'ষ্ট্র',
        'kœ':'শ্ন', 'e¨':'ব্য', '¯¿':'স্ত্র', 'Ë¡':'ত্ত্ব', '›Ø':'দ্বন্দ্ব',
        'cœ':'প্ন', 'Z¨':'ত্য', '¯‹«':'স্ক্র', '÷«':'স্ট্র', '_«':'থ্র',
        'c&c':'প্প', 'c&m':'প্স', '¼¶':'ঙ্ক্ষ', 'O&g':'ঙ্ম', '\xBB':'গ্ধ', '»':'গ্ধ',
        '¨':'্য', '«':'্র', '&':'্',
        'Kz':'কু', 'K‚':'কূ', 'Pz':'চু', 'P‚':'চূ', 'Sz':'ঝু', 'S‚':'ঝূ',
        'Zz':'তু', 'Z‚':'তূ', 'iƒ':'রূ', 'f‚':'ভূ', 'K…':'কৃ', 'Z…':'তৃ',
        'Zz¨':'ত্যু', 'cz¨':'প্যু', 'dz¨':'ফ্যু', 'fz¨':'ভ্যু', 'n~¨':'হ্যু',
        'Ky¨':'ক্যু', '¸¨':'গ্যু', 'Pz¨':'চ্যু', 'Rz¨':'জ্যু', 'Wz¨':'ড্যু', 'ùz':'স্ফু',
        '`y¨':'দ্যু', 'ay¨':'ধ্যু', 'ey¨':'ব্যু', 'jy¨':'ল্যু', 'k~¨':'শ্যু',
        'Z‚¨':'ত্যূ'
    };

    const keys = Object.keys(b2uJukta).sort((a, b) => b.length - a.length);
    for (const key of keys) { str = str.split(key).join(b2uJukta[key]); }

    const b2u = {
        'A':'অ', 'B':'ই', 'C':'ঈ', 'D':'উ', 'E':'ঊ', 'F':'ঋ', 'G':'এ', 'H':'ঐ',
        'I':'ও', 'J':'ঔ', 'K':'ক', 'L':'খ', 'M':'গ', 'N':'ঘ', 'O':'ঙ', 'P':'চ',
        'Q':'ছ', 'R':'জ', 'S':'ঝ', 'T':'ঞ', 'U':'ট', 'V':'ঠ', 'W':'ড', 'X':'ঢ',
        'Y':'ণ', 'Z':'ত', '_':'থ', '`':'দ', 'a':'ধ', 'b':'ন', 'c':'প', 'd':'ফ',
        'e':'ব', 'f':'ভ', 'g':'ম', 'h':'য', 'i':'র', 'j':'ল', 'k':'শ', 'l':'ষ',
        'm':'স', 'n':'হ', 'o':'ড়', 'p':'ঢ়', 'q':'য়', 'r':'ৎ', 's':'ং', 't':'ঃ',
        'u':'ঁ', 'v':'া', 'w':'ি', 'x':'ী', 'y':'ু', '~':'ূ', 'z':'ু', '‚':'ূ',
        '\x82':'ূ', '\x85':'ৃ', '…':'ৃ', '„':'ৃ', '\x84':'ৃ',
        '\x86':'ে', '†':'ে', '\x87':'ে', '‡':'ে',
        '\x88':'ৈ', 'ˆ':'ৈ', '\x8A':'ৗ', 'Š':'ৗ',
        '|':'।',
        '0':'০', '1':'১', '2':'২', '3':'৩', '4':'৪',
        '5':'৫', '6':'৬', '7':'৭', '8':'৮', '9':'৯',
        '©':'©'
    };

    str = str.replace(/Av/g, 'আ');
    let out = "";
    for (let i = 0; i < str.length; i++) { out += b2u[str[i]] || str[i]; }
    str = out;

    const cons = "কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহড়ঢ়য়ৎংঃঁ";
    const regexOrder = new RegExp(
        "([িেৈ])?([" + cons + "](?:\u09CD[" + cons + "])*)(©)?([াীুূৃৗ])?",
        "g"
    );

    str = str.replace(regexOrder, function(match, preKar, cluster, ref, postKar) {
        return (ref ? "র্" : "") + cluster + (preKar || "") + (postKar || "");
    });

    str = str
        .replace(/অা/g, 'আ')
        .replace(/েৃ/g, 'ৃ')
        .replace(/ৌ/g, 'ৌ')
        .replace(/ো/g, 'ো')
        .replace(/([ুূৃ])্য/g, '্য$1');

    return str.normalize("NFC");
}

// --- CONVERTER HANDLER ---
async function runSmartConverter(direction) {
    const btnId = direction === "UniToBijoy" ? "btnUniToBijoy" : "btnBijoyToUni";
    setLoading(btnId, true);

    try {
        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            selection.load("text, font/bold, font/italic, font/size");
            const paras = selection.paragraphs;
            paras.load("items");
            await context.sync();

            const rawText = selection.text;
            if (!rawText || !rawText.trim()) { 
                showStatus("অনুগ্রহ করে ডকুমেন্টের যে লেখাটুকু কনভার্ট করবেন তা আগে সিলেক্ট করুন!", true); 
                return; 
            }

            let origAlign = "Left";
            if (paras.items.length > 0) {
                paras.items[0].load("alignment");
                await context.sync();
                origAlign = paras.items[0].alignment || "Left";
            }

            let origBold = selection.font.bold === true;
            let origItalic = selection.font.italic === true;
            let origSize = selection.font.size || 10.5;

            let isUnicode = /[\u0980-\u09FF]/.test(rawText);
            let targetDirection = direction;
            if (isUnicode && direction === "BijoyToUni") targetDirection = "UniToBijoy";
            else if (!isUnicode && direction === "UniToBijoy") targetDirection = "BijoyToUni";

            let prefix = targetDirection === "UniToBijoy" ? "u2b" : "b2u";
            let fontInput = document.getElementById(`${prefix}-font`);
            let sizeInput = document.getElementById(`${prefix}-size`);
            
            let customFontName = fontInput ? fontInput.value.trim() : "";
            let customFontSize = sizeInput ? sizeInput.value.trim() : "";

            let defaultFont = targetDirection === "UniToBijoy" ? "SutonnyMJ" : "Kalpurush";
            let finalFontName = customFontName !== "" ? customFontName : defaultFont;
            let finalFontSize = customFontSize !== "" ? parseFloat(customFontSize) : origSize;

            let cursor = selection.insertText("", "Replace");
            cursor.paragraphs.load("items");
            await context.sync();
            
            if (cursor.paragraphs.items.length > 0) {
                cursor.paragraphs.items[0].alignment = origAlign;
            }

            if (targetDirection === "UniToBijoy") {
                let chunkRegex = /([ \t\r\n\v\(\)\[\]\{\}\'\"‘“’”\.\,\:\;\!\?\-\/\$\%\+\=\<\>°_@#&\*\\a-zA-Z0-9]+)/g;
                let textChunks = rawText.split(chunkRegex);

                for (let i = 0; i < textChunks.length; i++) {
                    let chunk = textChunks[i];
                    if (!chunk) continue;
                    
                    let rng = cursor.insertText(/[a-zA-Z0-9]/.test(chunk) ? chunk : convertUnicodeToBijoy(chunk), "Before");
                    if (/[^\s]/.test(chunk)) { 
                        rng.font.name = /[a-zA-Z0-9]/.test(chunk) ? "Times New Roman" : finalFontName; 
                    }
                    rng.font.size = finalFontSize; 
                    rng.font.bold = origBold; 
                    rng.font.italic = origItalic;
                }
            } else {
                // Bijoy/ANSI text and ordinary English both use ASCII code points.
                // Use the source font to distinguish legacy-Bijoy runs from real
                // English, then convert only the unprotected portions.
                const isBijoyFontName = (fontName) => {
                    const name = String(fontName || "").toLowerCase().replace(/\s+/g, "");
                    return /sutonny/.test(name) ||
                           /(?:^|[^a-z])(?:bijoy|boishakhi|adorsho?lipi)(?:$|[^a-z])/.test(name) ||
                           /(?:xmj|omj|emj|sjmj|bijoyclassic|bijoyclassicfont)/.test(name);
                };

                const latinMatches = selection.search("[A-Za-z0-9]{1,}", {
                    matchCase: false,
                    matchWildcards: true
                });
                latinMatches.load("items/text");
                await context.sync();

                for (const match of latinMatches.items) match.font.load("name");
                await context.sync();

                // Keep exact occurrence positions so repeated English words do not
                // cause a global split/join replacement.
                const protectedSpans = [];
                let scanFrom = 0;

                for (const match of latinMatches.items) {
                    const matchText = String(match.text || "");
                    if (!matchText) continue;

                    const matchIndex = rawText.indexOf(matchText, scanFrom);
                    if (matchIndex < 0) continue;

                    const sourceFont = String(match.font?.name || "");
                    const isNumberOnly = /^[0-9]+$/.test(matchText);
                    if (isNumberOnly || !isBijoyFontName(sourceFont)) {
                        protectedSpans.push({
                            start: matchIndex,
                            end: matchIndex + matchText.length,
                            text: matchText,
                            fontName: sourceFont
                        });
                    }
                    scanFrom = matchIndex + matchText.length;
                }

                let outputParts = [];
                let cursorPos = 0;

                const pushConverted = (textPart) => {
                    if (!textPart) return;
                    outputParts.push({
                        type: "converted",
                        text: convertBijoyToUnicode(textPart)
                    });
                };

                for (const span of protectedSpans) {
                    if (span.start < cursorPos) continue;
                    pushConverted(rawText.slice(cursorPos, span.start));
                    outputParts.push({
                        type: "protected",
                        text: span.text,
                        fontName: span.fontName
                    });
                    cursorPos = span.end;
                }
                pushConverted(rawText.slice(cursorPos));

                for (const part of outputParts) {
                    if (!part.text) continue;
                    const rng = cursor.insertText(part.text, "Before");

                    if (part.type === "protected") {
                        if (part.fontName) rng.font.name = part.fontName;
                    } else if (/[^\s]/.test(part.text)) {
                        rng.font.name = finalFontName;
                    }

                    rng.font.size = finalFontSize;
                    rng.font.bold = origBold;
                    rng.font.italic = origItalic;
                }
            }
            await context.sync(); 
            showStatus(`সফলভাবে কনভার্ট সম্পন্ন হয়েছে!`);
        });
    } catch (error) { 
        showStatus("Error: " + (error.message || "Unknown"), true); 
    } finally {
        setLoading(btnId, false);
    }
}

// --- ENGLISH FONT FIXER ---
// Changes only Latin letters/numbers inside the current Word selection.
// Bangla text and surrounding paragraph formatting are left untouched.
async function fixEnglishFont() {
    try {
        const fontInput = document.getElementById("fix-font");
        const targetFont = fontInput?.value?.trim() || "Times New Roman";

        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            selection.load("text");
            await context.sync();

            if (!selection.text || !selection.text.trim()) {
                showStatus("Please select the text where you want to fix English fonts.", true);
                return;
            }

            // Word wildcard search: [A-Za-z0-9]@ matches each contiguous
            // English/Latin/numeric run without touching Bangla characters.
            const matches = selection.search("[A-Za-z0-9]@", {
                matchCase: false,
                matchWildcards: true
            });
            matches.load("items/text");
            await context.sync();

            if (!matches.items.length) {
                showStatus("No English letters or numbers were found in the selected text.", true);
                return;
            }

            for (const match of matches.items) {
                match.font.name = targetFont;
            }

            await context.sync();
            showStatus(`English fonts fixed to ${targetFont}.`);
        });
    } catch (error) {
        showStatus("English Font Fixer error: " + (error.message || "Unknown error"), true);
    }
}

// --- MCQ FORMATTING CORE ENGINES ---
function sanitizeQuestionAnswers(q) {
    if (!q) return;

    // Normalize an answer already supplied by an "উত্তর / DËi / Answer" line.
    if (q.answer) {
        q.answer = normalizeAnswerLabel(q.answer);
        q.original_answer = q.answer;
    }

    if (!Array.isArray(q.options)) return;

    // In Bijoy source, the answer is often stored at the end of the last
    // option as P/Q/R/S (or K/L/M/N). Strip that marker and preserve it.
    // Only inspect the final option so ordinary English words ending in one
    // of these letters are never altered in earlier options.
    const lastIndex = q.options.length - 1;
    if (lastIndex >= 0) {
        const text = q.options[lastIndex][1];
        if (typeof text === "string") {
            const match = text.match(/(?:^|\s)([PQRSK-N])\s*$/i);
            if (match) {
                const answerMap = {
                    "P":"ক","Q":"খ","R":"গ","S":"ঘ",
                    "K":"ক","L":"খ","M":"গ","N":"ঘ"
                };
                const detected = answerMap[match[1].toUpperCase()];
                const cleaned = text.replace(/\s+(?:[PQRSK-N])\s*$/i, "").trim();

                // If an explicit answer line exists, only remove the trailing
                // marker when it agrees with that answer. Otherwise treat the
                // marker as the legacy embedded answer.
                const answerAgrees = !q.answer || normalizeAnswerLabel(q.answer) === detected;
                if (cleaned && cleaned !== text.trim() && detected && answerAgrees) {
                    q.options[lastIndex][1] = cleaned;
                    if (!q.answer) {
                        q.answer = detected;
                        q.original_answer = detected;
                    }
                }
            }
        }
    }

    // Final fallback: keep answer information if a legacy parser supplied
    // K/L/M/N or P/Q/R/S directly.
    if (q.answer) {
        q.answer = normalizeAnswerLabel(q.answer);
        q.original_answer = q.answer;
    }
}

function mcqIsOptionLine(line) {
    return /^\s*\(?[কখগঘA-DK-N]\)?[\.\)\]:：]\s+/.test(String(line || "").trim());
}

function mcqIsAnswerLine(line) {
    return /^\s*(?:সঠিক উত্তর|উত্তর|উ|Ans|Answer|mwVK DËi|DËi|D)\s*[:：\.]?/i.test(String(line || "").trim());
}

function mcqIsExplanationLine(line) {
    return /^\s*(?:ব্যাখ্যা|Explanation|e¨vL¨v)\s*[:\-–—]/i.test(String(line || "").trim());
}

function mcqFindNextMeaningfulLine(lines, fromIndex) {
    for (let i = fromIndex + 1; i < lines.length; i++) {
        const value = String(lines[i] || "").trim();
        if (value) return value;
    }
    return "";
}

function mcqLooksLikeQuestionStart(line, nextLine) {
    const current = String(line || "").trim();
    const next = String(nextLine || "").trim();
    if (!current || mcqIsOptionLine(current) || mcqIsAnswerLine(current) || mcqIsExplanationLine(current)) return false;
    if (/^\s*(?:\d+|[০-৯]+)\s*[\.\)\]]\s*/.test(current)) return true;
    return mcqIsOptionLine(next);
}

function parseQuestions(text) {
    let cleanText = String(text || "").replace(/([\r\n\v]+)/g, "\n");
    let lines = cleanText.split("\n");
    let questions = [];
    let current = null;

    function flush() {
        if (current && current.question && current.options.length > 0) {
            sanitizeQuestionAnswers(current);
            questions.push(current);
        }
        current = null;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = String(lines[i] || "").trim();
        if (!line) continue;
        const nextLine = mcqFindNextMeaningfulLine(lines, i);

        let expMatch = line.match(/^\s*(?:ব্যাখ্যা|Explanation|e¨vL¨v)\s*[: \-\u2013\u2014]\s*(.+)$/i);
        if (expMatch && current) {
            current.explanation = expMatch[1].trim();
            continue;
        }

        let ansMatch = line.match(/^\s*(?:সঠিক উত্তর|উত্তর|উ|Ans|Answer|mwVK DËi|DËi|D)\s*[:：\.]?\s*(.*)$/i);
        if (ansMatch && current) {
            const ansContent = ansMatch[1] || "";
            const ansExtr = ansContent.match(/[\(\[\{]?\s*([ক-ঘA-DK-NP-Sa-dk-np-s])\s*[\)\]\}]?/);
            if (ansExtr) {
                current.answer = normalizeAnswerLabel(ansExtr[1]);
                current.original_answer = current.answer;
                current.answerFormat = mcqCaptureAnswerFormat(line, ansContent, ansExtr);
            }
            continue;
        }

        if (mcqLooksLikeQuestionStart(line, nextLine)) {
            flush();
            let qMatch = line.match(/^\s*((?:\d+|[০-৯]+))\s*[\.\ \)\]]\s*(.*)$/);
            let rawQ = qMatch ? qMatch[2] : line;
            let optPattern = /([ক-ঘK-N])\s*[\.\) :]\s*(.+?)(?=\s+[ক-ঘK-N]\s*[\.\) :]\s*|$)/g;
            let optionsFound = [];
            let questionText = rawQ;
            let firstOptIndex = rawQ.search(/(?:\s+|^)([ক-ঘK-N])\s*[\.\) :]\s*/);

            if (firstOptIndex !== -1) {
                questionText = rawQ.substring(0, firstOptIndex).trim();
                let optionsPart = rawQ.substring(firstOptIndex).trim();
                let match;
                while ((match = optPattern.exec(optionsPart)) !== null) {
                    optionsFound.push([normalizeAnswerLabel(match[1]), match[2].trim()]);
                }
            }

            current = {
                question: questionText,
                questionNumber: qMatch ? qMatch[1] : null,
                _sourceLineIndex: i,
                options: optionsFound,
                answer: null,
                explanation: null,
                original_answer: null
            };
            continue;
        }

        if (!current) continue;

        let optPattern = /([ক-ঘK-N])\s*[\.\) :]\s*(.+?)(?=\s+[ক-ঘK-N]\s*[\.\) :]\s*|$)/g;
        let match;
        let foundInline = false;
        while ((match = optPattern.exec(line)) !== null) {
            current.options.push([normalizeAnswerLabel(match[1]), match[2].trim()]);
            foundInline = true;
        }
        if (foundInline) continue;

        let singleOptMatch = line.match(/^\s*\(?([ক-ঘA-DKLMNa-dklmn])\)?[. :]?\s*(.+?)$/);
        if (singleOptMatch) {
            current.options.push([normalizeAnswerLabel(singleOptMatch[1]), singleOptMatch[2].trim()]);
            continue;
        }

        // A non-option line followed by another option is a new question.
        if (current.options.length > 0 && mcqLooksLikeQuestionStart(line, nextLine)) {
            flush();
            current = {
                question: line,
                questionNumber: null,
                _sourceLineIndex: i,
                options: [],
                answer: null,
                explanation: null,
                original_answer: null
            };
            continue;
        }

        if (current.options.length > 0) {
            current.options[current.options.length - 1][1] += " " + line;
        } else {
            current.question += " " + line;
        }
    }

    flush();
    return questions;
}
function shuffleOptions(question) {
    if (!question.options || question.options.length < 2 || !question.answer) return question;
    
    let originalAns = question.original_answer || question.answer;
    let correctText = null;
    
    for (let i = 0; i < question.options.length; i++) {
        if (question.options[i][0] === originalAns) { correctText = question.options[i][1]; break; }
    }
    if (!correctText) return question;

    let shuffled = question.options.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let newOptions = [];
    let newAnswer = null;
    for (let i = 0; i < shuffled.length; i++) {
        let newLabel = OPTION_ORDER[i] || shuffled[i][0];
        newOptions.push([newLabel, shuffled[i][1]]);
        if (shuffled[i][1] === correctText) { newAnswer = newLabel; }
    }
    
    question.options = newOptions;
    question.answer = newAnswer;
    return question;
}

function mcqReadTabStopsFromOOXML(ooxml) {
    const result = [];
    if (!ooxml) return result;
    const tabsBlockMatch = ooxml.match(/<w:tabs\b[^>]*>([\s\S]*?)<\/w:tabs>/i);
    if (!tabsBlockMatch) return result;
    const tabRegex = /<w:tab\b([^>]*?)(?:\/>|>[\s\S]*?<\/w:tab>)/gi;
    let match;
    while ((match = tabRegex.exec(tabsBlockMatch[1])) !== null) {
        const attrs = match[1] || "";
        const posMatch = attrs.match(/w:pos="([\d.]+)"/i);
        if (!posMatch) continue;
        const valMatch = attrs.match(/w:val="([^"]+)"/i);
        result.push({ position: parseFloat(posMatch[1]) / 20, alignment: valMatch ? valMatch[1] : "left" });
    }
    return result.sort((a, b) => a.position - b.position);
}

async function mcqReadSelectedParagraphTabStops(context, paragraph) {
    try {
        if (!Office.context.requirements.isSetSupported("WordApi", "1.1")) return [];
        const ooxml = paragraph.getOoxml();
        await context.sync();
        return mcqReadTabStopsFromOOXML(ooxml.value || "");
    } catch (error) { return []; }
}

async function mcqGetCurrentColumnWidth(context) {
    try {
        if (!Office.context.requirements.isSetSupported("WordApi", "1.3")) return 350;
        const sections = context.document.getSelection().sections;
        sections.load("items");
        await context.sync();
        if (!sections.items.length) return 350;
        
        const pageSetup = sections.items[0].pageSetup;
        pageSetup.load("pageWidth,leftMargin,rightMargin,gutter");
        const columns = pageSetup.textColumns;
        columns.load("items");
        await context.sync();

        if (columns.items.length > 0 && typeof columns.items[0].width === "number") {
            return columns.items[0].width;
        }
        const width = pageSetup.pageWidth - pageSetup.leftMargin - pageSetup.rightMargin - (pageSetup.gutter || 0);
        return width > 0 ? width : 350;
    } catch (error) { 
        return 350; 
    }
}

function mcqGetOptionSlots(tabStops, columnWidth) {
    if (!Array.isArray(tabStops) || tabStops.length < 2) return null;
    const sorted = tabStops.filter(t => Number.isFinite(Number(t.position))).slice().sort((a, b) => a.position - b.position);
    if (sorted.length < 2) return null;

    const firstTab = sorted[0].position;
    const secondTab = sorted[1].position;
    if (secondTab <= firstTab) return null;

    const firstSlot = secondTab - firstTab;
    let secondSlot = null;

    if (sorted.length >= 3 && sorted[2].position > secondTab) {
        secondSlot = sorted[2].position - secondTab;
    } else if (Number.isFinite(columnWidth) && columnWidth > secondTab) {
        secondSlot = columnWidth - secondTab;
    }

    if (firstSlot <= 0 || !secondSlot || secondSlot <= 0) return null;
    return { firstSlot, secondSlot };
}

function mcqMeasureTextPoints(text, fontName, fontSize, bold = false) {
    text = String(text || "");
    if (!text) return 0;
    let size = parseFloat(fontSize) || 10.5;
    const canvas = mcqMeasureTextPoints.canvas || (mcqMeasureTextPoints.canvas = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = `${bold ? "700 " : "400 "}${size * (96 / 72)}px "${String(fontName || "Arial").replace(/["']/g, "")}"`;
    return ctx.measureText(text).width * (72 / 96);
}

function mcqMeasureOptionWidth(option, optionFont, optionSize, textFont, textSize, bold, useSymbols, isUnicode) {
    const labelText = option[0] || "";
    const marker = useSymbols ? (OPTION_EXPORT_MAP[labelText] || labelText) : getStandardOptionMarker(labelText, isUnicode);
    const markerFont = useSymbols ? optionFont : textFont;
    const markerSize = useSymbols ? optionSize : textSize;
    const text = String(option[1] || "").replace(/[\r\n\v]/g, " ").trim();
    return mcqMeasureTextPoints(marker, markerFont, markerSize, bold) + mcqMeasureTextPoints(` ${text}`, textFont, textSize, bold) + 2;
}

function mcqOptionFitsSlot(option, slotWidth, optionFont, optionSize, targetFont, targetSize, bold, useSymbols, isUnicode) {
    if (!option || !Number.isFinite(slotWidth) || slotWidth <= 0) return false;
    return (mcqMeasureOptionWidth(option, optionFont, optionSize, targetFont, targetSize, bold, useSymbols, isUnicode) * 1.08) <= slotWidth;
}

function mcqDetectAutoOptionLayout(options, tabStops, columnWidth, optionFont, optionSize, targetFont, targetSize, bold, useSymbols, isUnicode) {
    if (!options || options.length < 4) return { mode: "one-per-line" };
    const slots = mcqGetOptionSlots(tabStops, columnWidth);
    if (!slots) return { mode: "one-per-line" };
    
    const allFit = 
        mcqOptionFitsSlot(options[0], slots.firstSlot, optionFont, optionSize, targetFont, targetSize, bold, useSymbols, isUnicode) &&
        mcqOptionFitsSlot(options[1], slots.secondSlot, optionFont, optionSize, targetFont, targetSize, bold, useSymbols, isUnicode) &&
        mcqOptionFitsSlot(options[2], slots.firstSlot, optionFont, optionSize, targetFont, targetSize, bold, useSymbols, isUnicode) &&
        mcqOptionFitsSlot(options[3], slots.secondSlot, optionFont, optionSize, targetFont, targetSize, bold, useSymbols, isUnicode);
    return { mode: allFit ? "two-per-line" : "one-per-line" };
}


function mcqDecodeXmlText(value) {
    return String(value || "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function mcqExtractTextRunsFromOoxml(ooxml, fallbackStyle = {}) {
    const xml = String(ooxml || "");
    const runs = [];
    const runMatches = xml.match(/<w:r\b[\s\S]*?<\/w:r>/gi) || [];

    for (const run of runMatches) {
        let text = "";
        const textMatches = run.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/gi) || [];
        for (const node of textMatches) {
            text += mcqDecodeXmlText(
                node.replace(/^<w:t\b[^>]*>/i, "").replace(/<\/w:t>$/i, "")
            );
        }
        if (/<w:tab\b/i.test(run)) text += "\t";
        if (/<w:br\b/i.test(run)) text += "\n";
        if (!text) continue;

        const fontInfo = mcqExtractFontFromOoxml(
            run,
            fallbackStyle.fontName || fallbackStyle.name || ""
        );
        const sizeMatch = run.match(/<w:sz\b[^>]*w:val="(\d+)"/i);
        const bold = /<w:b(?:\s[^>]*)?\/?\s*>/i.test(run) &&
            !/<w:b\b[^>]*w:val="(?:0|false|off)"/i.test(run);
        const italic = /<w:i(?:\s[^>]*)?\/?\s*>/i.test(run) &&
            !/<w:i\b[^>]*w:val="(?:0|false|off)"/i.test(run);

        runs.push({
            text,
            fontName: fontInfo.name || fallbackStyle.fontName || fallbackStyle.name || "",
            ascii: fontInfo.ascii || fallbackStyle.ascii || "",
            hAnsi: fontInfo.hAnsi || fallbackStyle.hAnsi || "",
            cs: fontInfo.cs || fallbackStyle.cs || "",
            eastAsia: fontInfo.eastAsia || fallbackStyle.eastAsia || "",
            fontSize: sizeMatch ? Number(sizeMatch[1]) / 2 : Number(fallbackStyle.fontSize) || 0,
            bold,
            italic
        });
    }

    return runs;
}

function mcqSliceSourceRuns(runs, targetText) {
    const sourceRuns = Array.isArray(runs) ? runs : [];
    const target = String(targetText || "");
    if (!target || !sourceRuns.length) return [];

    const fullText = sourceRuns.map(run => run.text || "").join("");
    const start = fullText.indexOf(target);
    if (start < 0) return [];

    const end = start + target.length;
    const result = [];
    let cursor = 0;

    for (const run of sourceRuns) {
        const runStart = cursor;
        const runEnd = cursor + run.text.length;
        cursor = runEnd;

        const overlapStart = Math.max(start, runStart);
        const overlapEnd = Math.min(end, runEnd);
        if (overlapEnd <= overlapStart) continue;

        const from = overlapStart - runStart;
        const to = overlapEnd - runStart;
        result.push({
            text: run.text.slice(from, to),
            fontName: run.fontName,
            ascii: run.ascii,
            hAnsi: run.hAnsi,
            cs: run.cs,
            eastAsia: run.eastAsia,
            fontSize: run.fontSize,
            bold: run.bold,
            italic: run.italic
        });
    }

    return result;
}

function mcqInsertSourceText(paragraph, text, sourceRuns, fallbackStyle, forceBold, forceItalic, fallbackSize) {
    const value = String(text || "");
    if (!value) return;

    const segments = mcqSliceSourceRuns(sourceRuns, value);
    const list = segments.length ? segments : [{
        text: value,
        fontName: fallbackStyle?.fontName || fallbackStyle?.name || "",
        ascii: fallbackStyle?.ascii || "",
        hAnsi: fallbackStyle?.hAnsi || "",
        cs: fallbackStyle?.cs || "",
        eastAsia: fallbackStyle?.eastAsia || "",
        fontSize: Number(fallbackStyle?.fontSize) || Number(fallbackSize) || 0,
        italic: fallbackStyle?.italic === true
    }];

    for (const segment of list) {
        if (!segment.text) continue;
        const range = paragraph.insertText(segment.text, "End");
        const style = {
            fontName: segment.fontName || fallbackStyle?.fontName || fallbackStyle?.name || "",
            ascii: segment.ascii || fallbackStyle?.ascii || "",
            hAnsi: segment.hAnsi || fallbackStyle?.hAnsi || "",
            cs: segment.cs || fallbackStyle?.cs || "",
            eastAsia: segment.eastAsia || fallbackStyle?.eastAsia || "",
            fontSize: Number(segment.fontSize) || Number(fallbackSize) || Number(fallbackStyle?.fontSize) || 0
        };
        mcqApplySourceFontSafe(
            range,
            style,
            style.fontSize,
            forceBold === true,
            segment.italic === true ? true : forceItalic === true
        );
    }
}

function mcqExtractFontFromOoxml(ooxml, fallbackFont = "") {
    const xml = String(ooxml || "");
    const runMatches = xml.match(/<w:r\b[\s\S]*?<\/w:r>/gi) || [];
    for (const run of runMatches) {
        if (!/<w:t\b/i.test(run)) continue;
        const fontMatch = run.match(/<w:rFonts\b([^>]*)\/?>/i);
        if (!fontMatch) continue;
        const attrs = fontMatch[1] || "";
        const get = (name) => {
            const m = attrs.match(new RegExp("w:" + name + '="([^"]+)"', "i"));
            return m ? m[1] : "";
        };
        const ascii = get("ascii");
        const hAnsi = get("hAnsi");
        const cs = get("cs");
        const eastAsia = get("eastAsia");
        return {
            name: ascii || hAnsi || cs || eastAsia || fallbackFont || "",
            ascii: ascii || "",
            hAnsi: hAnsi || "",
            cs: cs || "",
            eastAsia: eastAsia || ""
        };
    }
    const paragraphFont = xml.match(/<w:rFonts\b([^>]*)\/?>/i);
    if (paragraphFont) {
        const attrs = paragraphFont[1] || "";
        for (const name of ["ascii", "hAnsi", "cs", "eastAsia"]) {
            const m = attrs.match(new RegExp("w:" + name + '="([^"]+)"', "i"));
            if (m && m[1]) return { name: m[1], ascii: m[1], hAnsi: m[1], cs: m[1], eastAsia: m[1] };
        }
    }
    return { name: fallbackFont || "", ascii: fallbackFont || "", hAnsi: fallbackFont || "", cs: fallbackFont || "", eastAsia: fallbackFont || "" };
}

function mcqApplySourceFontSafe(range, sourceStyle, fontSize, bold, italic) {
    const style = sourceStyle || {};
    const fontName = style.fontName || style.name || "";
    if (fontName) {
        range.font.name = fontName;
        try {
            if (typeof Office !== "undefined" && Office.context && Office.context.requirements &&
                Office.context.requirements.isSetSupported &&
                Office.context.requirements.isSetSupported("WordApiDesktop", "1.3")) {
                if (style.ascii) range.font.nameAscii = style.ascii;
                if (style.hAnsi) range.font.nameOther = style.hAnsi;
                if (style.eastAsia) range.font.nameFarEast = style.eastAsia;
                if (style.cs) range.font.nameBidirectional = style.cs;
            }
        } catch (e) {}
    }
    if (fontSize) range.font.size = fontSize;
    range.font.bold = bold === true;
    range.font.italic = italic === true;
}

function mcqApplyFontSafe(range, fontName, fontSize, bold, italic) {
    if (fontName) range.font.name = fontName;
    if (fontSize) range.font.size = fontSize;
    range.font.bold = bold === true;
    range.font.italic = italic === true;
}

function mcqInsertOption(paragraph, option, optionFont, optionSize, targetFont, targetSize, origBold, origItalic, leadingTab, useSymbols, isUnicode) {
    if (!option) return;
    const labelText = option[0] || "";
    const label = useSymbols ? (OPTION_EXPORT_MAP[labelText] || labelText) : getStandardOptionMarker(labelText, isUnicode);
    const sourceStyle = option._sourceStyle || {};
    const textFont = sourceStyle.fontName || targetFont;
    const textSize = Number(sourceStyle.fontSize) || targetSize;
    const textItalic = sourceStyle.italic === true;

    let text = String(option[1] || "").replace(/[\r\n\v]/g, " ").trim();
    const match = text.match(/\s+([PQRSK-N])\s*$/i);
    if (match) text = text.replace(/\s+([PQRSK-N])\s*$/i, "").trim();

    if (leadingTab) {
        const tabRange = paragraph.insertText("\t", "End");
        mcqApplySourceFontSafe(tabRange, sourceStyle, textSize, false, false);
    }

    const markerRange = paragraph.insertText(label, "End");
    if (useSymbols) {
        mcqApplyFontSafe(markerRange, optionFont, optionSize, false, textItalic);
    } else {
        const markerSegments = mcqSliceSourceRuns(option._sourceRuns || [], labelText);
        const markerStyle = markerSegments[0] || sourceStyle;
        mcqApplySourceFontSafe(
            markerRange,
            markerStyle,
            Number(markerStyle.fontSize) || textSize,
            false,
            markerStyle.italic === true || textItalic
        );
    }

    mcqInsertSourceText(
        paragraph,
        " " + text,
        option._sourceRuns || [],
        sourceStyle,
        false,
        textItalic,
        textSize
    );
}

function mcqResolveAnswer(question) {
    if (!question) return "";
    if (question.answer) return normalizeAnswerLabel(question.answer);

    const options = Array.isArray(question.options) ? question.options : [];
    for (let i = options.length - 1; i >= 0; i--) {
        const text = String(options[i]?.[1] || "");
        const match = text.match(/(?:^|\s)([PQRSK-N])\s*$/i);
        if (match) {
            return normalizeAnswerLabel(match[1]);
        }
    }
    return "";
}

function mcqInsertNormalAnswer(paragraph, question, answer, answerSize, origItalic, useSymbols, targetFont, targetSize, isUnicode) {
    const normalizedAnswer = normalizeAnswerLabel(answer);
    if (!normalizedAnswer) return;

    const answerSourceStyle = question?.answerStyle || question?.options?.[question.options.length - 1]?._sourceStyle || {};
    const answerSourceRuns = question?.options?.[question.options.length - 1]?._sourceRuns || [];
    const answerTargetSize = Number(answerSourceStyle.fontSize) || targetSize;
    let marker = "";
    let answerFont = answerSourceStyle.fontName || targetFont;
    let answerSizeToUse = answerTargetSize;

    if (useSymbols) {
        marker = ANSWER_EXPORT_MAP[normalizedAnswer] || normalizedAnswer;
        answerFont = "ProshnaP";
        answerSizeToUse = answerSize;
    } else {
        marker = mcqBuildPreservedAnswerText(question, normalizedAnswer) || getStandardAnswerMarker(normalizedAnswer, isUnicode);
    }

    const tabRange = paragraph.insertText("\t", "End");
    mcqApplySourceFontSafe(tabRange, answerSourceStyle, answerTargetSize, false, false);
    const answerRange = paragraph.insertText(marker, "End");
    if (!useSymbols) {
        const answerSegments = mcqSliceSourceRuns(answerSourceRuns, marker);
        if (answerSegments.length) {
            mcqApplySourceFontSafe(
                answerRange,
                answerSegments[0],
                Number(answerSegments[0].fontSize) || answerTargetSize,
                false,
                answerSegments[0].italic === true || origItalic
            );
            return;
        }
    }
    if (useSymbols) {
        mcqApplyFontSafe(answerRange, answerFont, answerSizeToUse, false, origItalic);
    } else {
        mcqApplySourceFontSafe(answerRange, answerSourceStyle, answerSizeToUse, false, origItalic);
    }
}

function mcqInsertNormalOptions(anchorRange, question, layout, optionFont, optionSize, targetFont, targetSize, origAlign, origBold, origItalic, answerSize, useSymbols, isUnicode) {
    const count = Math.min(4, question.options.length);
    if (layout.mode === "two-per-line") {
        for (let j = 0; j < count; j += 2) {
            const paragraph = anchorRange.insertParagraph("", "Before");
            paragraph.alignment = origAlign;
            
            mcqInsertOption(paragraph, question.options[j], optionFont, optionSize, targetFont, targetSize, origBold, origItalic, true, useSymbols, isUnicode);
            if (question.options[j + 1]) {
                let midTab = paragraph.insertText("\t", "End");
                mcqApplyFontSafe(midTab, targetFont, targetSize, false, false);
                mcqInsertOption(paragraph, question.options[j + 1], optionFont, optionSize, targetFont, targetSize, origBold, origItalic, false, useSymbols, isUnicode);
            }
            if (j + 2 >= count) {
                mcqInsertNormalAnswer(paragraph, question, mcqResolveAnswer(question), answerSize, origItalic, useSymbols, targetFont, targetSize, isUnicode);
            }
        }
    } else {
        for (let j = 0; j < count; j++) {
            const paragraph = anchorRange.insertParagraph("", "Before");
            paragraph.alignment = origAlign;
            
            mcqInsertOption(paragraph, question.options[j], optionFont, optionSize, targetFont, targetSize, origBold, origItalic, true, useSymbols, isUnicode);
            if (j === count - 1) mcqInsertNormalAnswer(paragraph, question, mcqResolveAnswer(question), answerSize, origItalic, useSymbols, targetFont, targetSize, isUnicode);
        }
    }
}

function mcqInsertSmartOptions(anchorRange, question, layout, optionFont, optionSize, targetFont, targetSize, origAlign, origBold, origItalic, useSymbols, isUnicode) {
    const count = Math.min(4, question.options.length);
    if (layout.mode === "two-per-line") {
        for (let j = 0; j < count; j += 2) {
            const paragraph = anchorRange.insertParagraph("", "Before");
            paragraph.alignment = origAlign;
            
            mcqInsertOption(paragraph, question.options[j], optionFont, optionSize, targetFont, targetSize, origBold, origItalic, true, useSymbols, isUnicode);
            if (question.options[j + 1]) {
                let midTab = paragraph.insertText("\t", "End");
                mcqApplyFontSafe(midTab, targetFont, targetSize, false, false);
                mcqInsertOption(paragraph, question.options[j + 1], optionFont, optionSize, targetFont, targetSize, origBold, origItalic, false, useSymbols, isUnicode);
            }
        }
    } else {
        for (let j = 0; j < count; j++) {
            const paragraph = anchorRange.insertParagraph("", "Before");
            paragraph.alignment = origAlign;
            mcqInsertOption(paragraph, question.options[j], optionFont, optionSize, targetFont, targetSize, origBold, origItalic, true, useSymbols, isUnicode);
        }
    }
}

function mcqInsertNormalExplanation(anchorRange, explanation, isUnicode, targetFont, origSize, origAlign, origBold, origItalic) {
    if (!explanation) return;
    const label = isUnicode ? "ব্যাখ্যা: " : "e¨vL¨v: ";
    const safe = String(explanation).replace(/[\r\n\v]/g, " ").trim();
    const paragraph = anchorRange.insertParagraph(`${label}${safe}`, "Before");
    mcqApplyFontSafe(paragraph, targetFont, origSize, origBold, origItalic);
    paragraph.alignment = origAlign;
}

function mcqInsertSmartAnswerPage(anchorRange, questions, isUnicode, targetFont, origSize, origAlign, origBold, origItalic, answerSize, useSymbols) {
    anchorRange.insertBreak("Page", "Before");
    const header = isUnicode ? "সঠিক উত্তর ও ব্যাখ্যা" : "mwVK DËi I e¨vL¨v";
    const headerPara = anchorRange.insertParagraph(header, "Before");
    mcqApplyFontSafe(headerPara, targetFont, 12, true, false);
    headerPara.alignment = "Centered";
    
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const number = isUnicode ? toBanglaNumber(i + 1) : i + 1;
        const label = isUnicode ? "উত্তর: " : "DËi: ";
        const answerPara = anchorRange.insertParagraph(`${number}. ${label}`, "Before");
        mcqApplyFontSafe(answerPara, targetFont, origSize, origBold, origItalic);
        answerPara.alignment = origAlign;
        
        let detectedAnswer = q.answer;
        if (q.options && q.options.length > 0) {
            const lastOpt = q.options[q.options.length - 1];
            if (typeof lastOpt[1] === "string") {
                const match = lastOpt[1].match(/\s+([PQRS])\s*$/i);
                if (match && !detectedAnswer) {
                    const map = { "P": "ক", "Q": "খ", "R": "গ", "S": "ঘ" };
                    detectedAnswer = map[match[1].toUpperCase()];
                }
            }
        }
        if (detectedAnswer) {
            if (useSymbols) {
                const ansMap = { "P": "K", "Q": "L", "R": "M", "S": "N", "ক": "P", "খ": "Q", "গ": "R", "ঘ": "S" };
                const marker = ansMap[detectedAnswer] || detectedAnswer;
                const range = answerPara.insertText(marker, "End");
                mcqApplyFontSafe(range, "ProshnaP", answerSize, false, origItalic);
            } else {
                const valMap = { "ক": "K", "খ": "L", "গ": "M", "ঘ": "N" };
                const normAns = normalizeAnswerLabel(detectedAnswer);
                const finalVal = isUnicode ? normAns : (valMap[normAns] || normAns);
                const range = answerPara.insertText(finalVal, "End");
                mcqApplyFontSafe(range, targetFont, origSize, false, origItalic);
            }
        }
        if (q.explanation) {
            const expLabel = isUnicode ? " ব্যাখ্যা: " : " e¨vL¨v: ";
            const safe = String(q.explanation).replace(/[\r\n\v]/g, " ").trim();
            const expPara = anchorRange.insertParagraph(`${expLabel}${safe}`, "Before");
            mcqApplyFontSafe(expPara, targetFont, origSize, origBold, origItalic);
            expPara.alignment = origAlign;
        }
    }
}

async function formatSelectedText(type) {
    try {
        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            const paragraphs = selection.paragraphs;
            paragraphs.load("items");
            await context.sync();

            if (!paragraphs.items.length) {
                showStatus("Please select some text in the document first!", true);
                return;
            }

            const paragraphOoxml = paragraphs.items.map(p => p.getOoxml());
            for (const p of paragraphs.items) {
                p.load("text, font/name, font/size, font/bold, font/italic, alignment");
            }
            selection.load("text, font/size");
            await context.sync();

            const text = selection.text || "";
            const origSize = Number(selection.font.size) || 10.5;
            if (!text.trim()) {
                showStatus("Please select some text in the document first!", true);
                return;
            }

            let origAlign = "Left";
            const originalParagraph = paragraphs.items[0];
            if (originalParagraph) origAlign = originalParagraph.alignment || "Left";

            const tabStops = originalParagraph
                ? await mcqReadSelectedParagraphTabStops(context, originalParagraph)
                : [];
            const columnWidth = await mcqGetCurrentColumnWidth(context);

            let questions = parseQuestions(text);
            if (!questions.length) {
                showStatus("No valid questions found in selection!", true);
                return;
            }

            let styleSearchIndex = 0;
            for (const q of questions) {
                const qText = String(q.question || "").trim();
                let foundIndex = -1;

                for (let pIndex = styleSearchIndex; pIndex < paragraphs.items.length; pIndex++) {
                    const sourceText = String(paragraphs.items[pIndex].text || "").trim();
                    if (qText && sourceText.includes(qText)) {
                        foundIndex = pIndex;
                        break;
                    }
                }

                if (foundIndex < 0) {
                    foundIndex = Math.min(
                        Math.max(Number(q._sourceLineIndex) || 0, 0),
                        paragraphs.items.length - 1
                    );
                }

                const source = paragraphs.items[foundIndex];
                const sourceFontInfo = mcqExtractFontFromOoxml(
                    paragraphOoxml[foundIndex]?.value || "",
                    source?.font?.name || ""
                );
                q.sourceStyle = {
                    fontName: sourceFontInfo.name || source?.font?.name || "",
                    ascii: sourceFontInfo.ascii || "",
                    hAnsi: sourceFontInfo.hAnsi || "",
                    cs: sourceFontInfo.cs || "",
                    eastAsia: sourceFontInfo.eastAsia || "",
                    fontSize: Number(source?.font?.size) || origSize,
                    italic: source?.font?.italic === true,
                    alignment: source?.alignment || origAlign
                };
                q.sourceRuns = mcqExtractTextRunsFromOoxml(
                    paragraphOoxml[foundIndex]?.value || "",
                    q.sourceStyle
                );
                q.questionRuns = mcqSliceSourceRuns(q.sourceRuns, qText);

                let optionSearchIndex = foundIndex + 1;
                for (const option of q.options) {
                    const optionLabel = normalizeAnswerLabel(option[0]);
                    let optionStyleFound = false;

                    for (let pIndex = optionSearchIndex; pIndex < paragraphs.items.length; pIndex++) {
                        const sourceText = String(paragraphs.items[pIndex].text || "").trim();
                        if (!sourceText) continue;

                        const nextText = mcqFindNextMeaningfulLine(
                            paragraphs.items.map(p => String(p.text || "")),
                            pIndex
                        );
                        if (pIndex > foundIndex && mcqLooksLikeQuestionStart(sourceText, nextText) && !mcqIsOptionLine(sourceText)) break;

                        const labelMatch = sourceText.match(/^\s*\(?([ক-ঘA-DK-N])\)?\s*[\.\)\]:：]\s*/i);
                        if (!labelMatch || normalizeAnswerLabel(labelMatch[1]) !== optionLabel) continue;

                        const optFontInfo = mcqExtractFontFromOoxml(
                            paragraphOoxml[pIndex]?.value || "",
                            paragraphs.items[pIndex]?.font?.name || q.sourceStyle.fontName
                        );
                        option._sourceStyle = {
                            fontName: optFontInfo.name || paragraphs.items[pIndex]?.font?.name || q.sourceStyle.fontName,
                            ascii: optFontInfo.ascii || "",
                            hAnsi: optFontInfo.hAnsi || "",
                            cs: optFontInfo.cs || "",
                            eastAsia: optFontInfo.eastAsia || "",
                            fontSize: Number(paragraphs.items[pIndex]?.font?.size) || q.sourceStyle.fontSize,
                            italic: paragraphs.items[pIndex]?.font?.italic === true
                        };
                        option._sourceRuns = mcqExtractTextRunsFromOoxml(
                            paragraphOoxml[pIndex]?.value || "",
                            option._sourceStyle
                        );
                        optionSearchIndex = pIndex + 1;
                        optionStyleFound = true;
                        break;
                    }

                    if (!optionStyleFound) option._sourceStyle = {...q.sourceStyle};
                }

                q.answerStyle = q.options.length
                    ? {...(q.options[q.options.length - 1]._sourceStyle || q.sourceStyle)}
                    : {...q.sourceStyle};

                styleSearchIndex = Math.max(styleSearchIndex, foundIndex + 1);
            }

            const shuffleElement = document.getElementById("shuffleCheck");
            if (shuffleElement && shuffleElement.checked) {
                questions = questions.map(q => shuffleOptions(q));
            }

            const normStyle = document.getElementById("norm-marker-style");
            const smartStyle = document.getElementById("smart-marker-style");
            const useSymbols = type === "normal"
                ? (!normStyle || normStyle.value !== "text")
                : (!smartStyle || smartStyle.value !== "text");

            const optFontElement = document.getElementById("norm-opt-font");
            const optSizeElement = document.getElementById("norm-opt-size");
            const normalAnswerElement = document.getElementById("norm-ans-size");
            const smartAnswerElement = document.getElementById("smart-ans-size");

            const optionFont = optFontElement && optFontElement.value.trim()
                ? optFontElement.value.trim() : "BanglaOMR";
            const optionSize = optSizeElement && parseFloat(optSizeElement.value) > 0
                ? parseFloat(optSizeElement.value) : 9;
            const normalAnswerSize = normalAnswerElement && parseFloat(normalAnswerElement.value) > 0
                ? parseFloat(normalAnswerElement.value) : 10;
            const smartAnswerSize = smartAnswerElement && parseFloat(smartAnswerElement.value) > 0
                ? parseFloat(smartAnswerElement.value) : 10;

            const anchorRange = selection.insertText(" ", "Replace");

            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                const sourceStyle = q.sourceStyle || {};
                const questionFont = sourceStyle.fontName || "Arial";
                const questionSize = Number(sourceStyle.fontSize) || origSize;
                const questionAlign = sourceStyle.alignment || origAlign;
                const questionItalic = sourceStyle.italic === true;
                const safeQuestion = String(q.question || "").replace(/[\r\n\v]/g, " ").trim();
                const isUnicode = /[\u0980-\u09FF]/.test(safeQuestion);
                const qNum = isUnicode ? toBanglaNumber(i + 1) : i + 1;

                const qPara = anchorRange.insertParagraph("", "Before");
                const numberRange = qPara.insertText(qNum + ". ", "End");
                mcqApplySourceFontSafe(numberRange, sourceStyle, questionSize, true, questionItalic);
                mcqInsertSourceText(
                    qPara,
                    safeQuestion,
                    q.questionRuns || q.sourceRuns || [],
                    sourceStyle,
                    true,
                    questionItalic,
                    questionSize
                );
                qPara.alignment = questionAlign;

                const layout = mcqDetectAutoOptionLayout(
                    q.options,
                    tabStops,
                    columnWidth,
                    optionFont,
                    optionSize,
                    questionFont,
                    questionSize,
                    false,
                    useSymbols,
                    isUnicode
                );

                if (type === "normal") {
                    mcqInsertNormalOptions(
                        anchorRange, q, layout, optionFont, optionSize,
                        questionFont, questionSize, questionAlign,
                        false, false, normalAnswerSize, useSymbols, isUnicode
                    );
                    mcqInsertNormalExplanation(
                        anchorRange, q.explanation, isUnicode,
                        questionFont, questionSize, questionAlign, false, false
                    );
                } else if (type === "smart") {
                    mcqInsertSmartOptions(
                        anchorRange, q, layout, optionFont, optionSize,
                        questionFont, questionSize, questionAlign,
                        false, false, useSymbols, isUnicode
                    );
                }
            }

            if (type === "smart") {
                const smartStyleData = questions[0]?.sourceStyle || {};
                mcqInsertSmartAnswerPage(
                    anchorRange,
                    questions,
                    /[\u0980-\u09FF]/.test(String(questions[0]?.question || "")),
                    smartStyleData.fontName || "Arial",
                    Number(smartStyleData.fontSize) || origSize,
                    smartStyleData.alignment || origAlign,
                    true,
                    smartStyleData.italic === true,
                    smartAnswerSize,
                    useSymbols
                );
            }

            anchorRange.delete();
            await context.sync();
            showStatus(String(questions.length) + " MCQs formatted successfully!");
        });
    } catch (error) {
        showStatus("Error: " + (error.message || "Unknown error"), true);
    }
}

async function formatQuestionsMacro() {
    try {
        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            const paragraphs = selection.paragraphs;
            paragraphs.load("items");
            await context.sync();

            if (paragraphs.items.length === 0) {
                showStatus("Please select text first.", true);
                return;
            }

            for (const p of paragraphs.items) p.load("text");
            await context.sync();

            const numStyle = document.getElementById("num-style").value;
            const items = paragraphs.items.map((p) => ({
                paragraph: p,
                text: String(p.text || "").trim()
            }));

            const matchingParagraphs = [];
            for (let i = 0; i < items.length; i++) {
                const current = items[i].text;
                if (!current) continue;
                if (mcqIsOptionLine(current) || mcqIsAnswerLine(current) || mcqIsExplanationLine(current)) continue;

                let next = "";
                for (let j = i + 1; j < items.length; j++) {
                    if (items[j].text) {
                        next = items[j].text;
                        break;
                    }
                }

                if (mcqLooksLikeQuestionStart(current, next)) {
                    matchingParagraphs.push(items[i].paragraph);
                }
            }

            if (matchingParagraphs.length === 0) {
                showStatus("No questions detected.", true);
                return;
            }

            if (numStyle.startsWith("auto-")) {
                let list = matchingParagraphs[0].startNewList();
                list.load("id");
                await context.sync();

                let listLevelType = Word.ListNumbering.arabic;
                if (numStyle === "auto-roman") listLevelType = Word.ListNumbering.lowerRoman;
                if (numStyle === "auto-alpha") listLevelType = Word.ListNumbering.lowerLetter;
                list.setLevelNumbering(0, listLevelType);

                for (let i = 0; i < matchingParagraphs.length; i++) {
                    const p = matchingParagraphs[i];
                    p.font.bold = true;
                    if (i > 0) p.attachToList(list.id, 0);
                }
            } else {
                let qCount = 0;
                for (const p of matchingParagraphs) {
                    p.font.bold = true;
                    const currentText = String(p.text || "").trim();
                    const hasNumber = /^\s*(?:\d+|[০-৯]+)\s*[\.\)\]]\s*/.test(currentText);

                    if (!hasNumber) {
                        const numText = getSequenceString(qCount, numStyle);
                        const numRange = p.insertText(numText, "Start");
                        numRange.font.bold = true;
                    }
                    qCount++;
                }
            }

            await context.sync();
            showStatus("Numbered and Bolded " + matchingParagraphs.length + " Questions!");
        });
    } catch (error) {
        showStatus("Error: " + (error.message || "Unknown"), true);
    }
}

// ==========================================
// DUPLICATE FINDER LOGIC
// ==========================================
function dupNormalizeUnicode(text) { return String(text || "").normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, ""); }
function dupNormalizeDigits(text) { return text.replace(/[০-৯]/g, ch => ({"০":"0","১":"1","২":"2","৩":"3","৪":"4","৫":"5","৬":"6","৭":"7","৮":"8","৯":"9"}[ch])); }
function dupNormalizeWhitespace(text) { return text.replace(/[\t\r\n\v\u00A0]+/g, " ").replace(/\s{2,}/g, " ").trim(); }
function dupStripPunctuation(text) { return text.replace(/[?!?।,:;؛'"“”‘’`~|\/\\()[\]{}<>+=*_\-–—]/g, " "); }
function dupNormalizeText(text, opts = {}) {
    let out = dupNormalizeUnicode(text);
    out = dupNormalizeDigits(out);
    if (opts.ignoreNumbers) out = out.replace(/\b\d+(?:[.,/]\d+)*\b/g, " ");
    if (opts.ignorePunctuation) out = dupStripPunctuation(out);
    return dupNormalizeWhitespace(out.toLocaleLowerCase());
}
function dupExtractNumbers(text) { return dupNormalizeDigits(dupNormalizeUnicode(text)).match(/\d+(?:[.,/]\d+)*/g) || []; }
function dupTokenize(text) { return dupNormalizeWhitespace(text).split(/\s+/).filter(Boolean); }
function dupJaccard(a, b) {
    const A = new Set(dupTokenize(a)), B = new Set(dupTokenize(b));
    if (!A.size && !B.size) return 1; if (!A.size || !B.size) return 0;
    let intersection = 0; A.forEach(x => { if (B.has(x)) intersection++; });
    return intersection / (A.size + B.size - intersection);
}
function dupLevenshtein(a, b) {
    if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
    if (a.length > b.length) [a, b] = [b, a];
    let prev = Array.from({length: a.length + 1}, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
        const cur = [j];
        for (let i = 1; i <= a.length; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[i] = Math.min(cur[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost);
        }
        prev = cur;
    }
    return prev[a.length];
}
function dupCharSimilarity(a, b) { const max = Math.max(a.length, b.length); return !max ? 1 : 1 - dupLevenshtein(a, b) / max; }
function dupNumberDifference(a, b) {
    const A = dupExtractNumbers(a), B = dupExtractNumbers(b);
    if (!A.length && !B.length) return false; if (A.length !== B.length) return true;
    return A.some((x, i) => x !== B[i]);
}
function dupOptionTexts(mcq) { return (mcq.options || []).map(x => Array.isArray(x) ? x[1] : (x.text || "")); }
function dupOptionMultisetSimilarity(a, b, opts) {
    const A = dupOptionTexts(a).map(x => dupNormalizeText(x, opts)).filter(Boolean);
    const B = dupOptionTexts(b).map(x => dupNormalizeText(x, opts)).filter(Boolean);
    if (!A.length && !B.length) return 1; if (A.length !== B.length) return 0;
    const used = new Set(); let total = 0;
    for (const x of A) {
        let best = 0, bestIndex = -1;
        for (let i = 0; i < B.length; i++) {
            if (used.has(i)) continue;
            const sim = Math.max(dupJaccard(x, B[i]), dupCharSimilarity(x, B[i]));
            if (sim > best) { best = sim; bestIndex = i; }
        }
        if (bestIndex >= 0) { used.add(bestIndex); total += best; }
    }
    return total / A.length;
}
function dupSameOptionOrder(a, b, opts) {
    const A = dupOptionTexts(a).map(x => dupNormalizeText(x, opts)), B = dupOptionTexts(b).map(x => dupNormalizeText(x, opts));
    if (A.length !== B.length) return false;
    return A.every((x, i) => Math.max(dupJaccard(x, B[i]), dupCharSimilarity(x, B[i])) >= 0.9);
}
function dupBuildComparable(mcq, opts) {
    return {
        question: dupNormalizeText(mcq.question, {...opts, ignoreNumbers: false}),
        options: dupOptionTexts(mcq).map(x => dupNormalizeText(x, {...opts, ignoreNumbers: false})),
        answer: normalizeAnswerLabel(mcq.answer || ""),
        numbers: dupExtractNumbers(mcq.question + " " + dupOptionTexts(mcq).join(" "))
    };
}
function dupSimilarity(a, b, opts) {
    const A = dupBuildComparable(a, opts), B = dupBuildComparable(b, opts);
    const q1 = A.question, q2 = B.question;
    const questionExact = q1 === q2;
    const questionToken = dupJaccard(q1, q2), questionChar = dupCharSimilarity(q1, q2);
    const questionScore = questionExact ? 1 : (0.45 * questionToken + 0.55 * questionChar);
    const optionScore = opts.compareOptions ? dupOptionMultisetSimilarity(a, b, opts) : 1;
    const sameOrder = dupSameOptionOrder(a, b, opts);
    const numericDifference = opts.protectNumbers && dupNumberDifference(a.question + " " + dupOptionTexts(a).join(" "), b.question + " " + dupOptionTexts(b).join(" "));
    let score = (questionScore * 0.72) + (optionScore * 0.28);
    if (numericDifference) score = Math.min(score, 0.82);
    const answerConflict = !!A.answer && !!B.answer && A.answer !== B.answer && questionScore >= 0.9 && optionScore >= 0.75;
    return {
        score, questionScore, optionScore, sameOrder, optionReordered: opts.ignoreOptionOrder && !sameOrder && optionScore >= 0.9,
        numericDifference, answerConflict, exact: questionExact && optionScore >= 0.999 && !numericDifference, questionOnlySame: questionExact
    };
}
function dupCandidateSignature(mcq, opts) {
    const tokens = dupTokenize(
        dupNormalizeText(mcq.question, {
            ignorePunctuation: true,
            ignoreNumbers: false
        })
    ).filter(t => t.length > 1);

    return `${tokens.length}\vert{}${tokens.slice(0, 4).join(" ")}`;
}
function dupMakeGroups(matches, count) {
    const parent = Array.from({length: count}, (_, i) => i);
    const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
    matches.forEach(m => { let a = find(m.a), b = find(m.b); if (a !== b) parent[b] = a; });
    const groups = new Map();
    matches.forEach(m => { const root = find(m.a); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(m); });
    return [...groups.values()].map((edges, idx) => {
        const ids = [...new Set(edges.flatMap(e => [e.a, e.b]))];
        return { id: idx + 1, ids, edges, strongest: edges.reduce((x, y) => y.analysis.score > x.analysis.score ? y : x, edges[0]), exact: edges.some(e => e.analysis.exact), conflict: edges.some(e => e.analysis.answerConflict) };
    });
}
function dupEscapeHtml(text) { return String(text || "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch])); }
function dupNormalizeForParagraphMatch(text) { return dupNormalizeText(text, {ignorePunctuation: true, ignoreNumbers: false}).toLowerCase(); }
function dupParagraphLooksLikeQuestion(paragraphText, mcq) {
    const p = dupNormalizeForParagraphMatch(paragraphText), q = dupNormalizeForParagraphMatch(mcq.question);
    if (!p || !q) return false; if (p.includes(q)) return true;
    const needle = q.split(/\s+/).filter(Boolean).slice(0, 10).join(" ");
    return needle.length >= 8 && p.includes(needle);
}
async function dupReadWordParagraphs(context, selection) {
    const paragraphs = selection.paragraphs; paragraphs.load("items"); await context.sync();
    const supportsUniqueId = Office.context.requirements && Office.context.requirements.isSetSupported("WordApi", "1.6");
    for (const p of paragraphs.items) {
        p.load("text,isListItem"); p.listItemOrNullObject.load("isNullObject,listString");
        if (supportsUniqueId) p.load("uniqueLocalId");
    }
    await context.sync();
    return paragraphs.items.map((p, index) => ({
        index, text: p.text || "", isListItem: !!p.isListItem, listString: p.listItemOrNullObject && !p.listItemOrNullObject.isNullObject ? (p.listItemOrNullObject.listString || "") : "", uniqueLocalId: supportsUniqueId ? (p.uniqueLocalId || null) : null
    }));
}
function dupAttachWordMetadata(mcqs, paragraphInfos) {
    const usedParagraphs = new Set(); let searchStart = 0;
    for (const mcq of mcqs) {
        let matched = null;
        const candidates = [mcq._sourceLineIndex, mcq._sourceLineIndex - 1, mcq._sourceLineIndex + 1];
        for (const idx of candidates) {
            if (Number.isInteger(idx) && idx >= 0 && idx < paragraphInfos.length && !usedParagraphs.has(idx) && dupParagraphLooksLikeQuestion(paragraphInfos[idx].text, mcq)) { matched = paragraphInfos[idx]; break; }
        }
        if (!matched) {
            for (let i = searchStart; i < paragraphInfos.length; i++) {
                if (!usedParagraphs.has(i) && dupParagraphLooksLikeQuestion(paragraphInfos[i].text, mcq)) { matched = paragraphInfos[i]; break; }
            }
        }
        if (!matched) {
            for (let i = 0; i < paragraphInfos.length; i++) {
                if (!usedParagraphs.has(i) && dupParagraphLooksLikeQuestion(paragraphInfos[i].text, mcq)) { matched = paragraphInfos[i]; break; }
            }
        }
        if (matched) {
            usedParagraphs.add(matched.index); searchStart = matched.index + 1;
            const autoNumber = String(matched.listString || "").trim();
            if (!mcq.questionNumber && autoNumber) mcq.questionNumber = autoNumber.replace(/[\s]+$/, "");
            mcq.wordParagraphId = matched.uniqueLocalId || null;
            mcq.wordDocumentOccurrence = matched.index;
        }
    }
}
function dupRenderQuestionSummary(mcq) {
    const n = String(mcq && mcq.questionNumber || "").trim().replace(/[\s]+$/, "") || "Unnumbered";
    return `<div class="font-semibold text-slate-700 text-xs">Q${dupEscapeHtml(n)}</div><div class="dup-question-text text-[11px] text-slate-600 mt-0.5">${dupEscapeHtml(mcq.question)}</div>`;
}
function renderDuplicateFinderResults(groups, mcqs, threshold) {
    const root = document.getElementById("duplicateResults");
    if (!groups.length) { root.innerHTML = `<div class="bg-green-50 border border-green-200 rounded-lg p-3 text-center text-xs text-green-700"><i class="fas fa-check-circle mr-1"></i>No duplicate or high-similarity MCQ groups found at ${threshold}% threshold.</div>`; return; }
    root.innerHTML = groups.map(group => {
        const pct = Math.round(group.strongest.analysis.score * 100);
        const type = group.conflict ? "conflict" : (group.exact ? "exact" : (pct >= 95 ? "very-high" : "potential"));
        const color = type === "exact" ? "red" : type === "conflict" ? "yellow" : type === "very-high" ? "orange" : "amber";
        const label = type === "exact" ? "Exact Duplicate" : type === "conflict" ? "Answer Conflict" : type === "very-high" ? "Very High Similarity" : "Potential Duplicate";
        const cards = group.ids.map(id => `<div class="border border-slate-200/80 rounded p-2 bg-white cursor-pointer hover:border-blue-400" onclick="navigateToDuplicateQuestion(${id})">${dupRenderQuestionSummary(mcqs[id])}</div>`).join("");
        return `<details class="dup-result-card bg-${color}-50 border border-${color}-200 rounded-lg p-2" open>
            <summary class="cursor-pointer list-none flex items-center justify-between"><span class="text-xs font-bold text-${color}-800"><i class="fas ${type === 'conflict' ? 'fa-exclamation-triangle' : type === 'exact' ? 'fa-copy' : 'fa-clone'} mr-1"></i>Group ${group.id} —${label}</span><span class="text-xs font-extrabold text-${color}-800">${pct}%</span></summary>
            <div class="mt-2 space-y-2">${cards}<div class="flex gap-2"><button class="flex-1 text-[11px] bg-white border border-slate-200 rounded py-1 hover:bg-slate-50 font-medium" onclick="event.stopPropagation(); compareDuplicateQuestions(${group.strongest.a},${group.strongest.b})"><i class="fas fa-columns mr-1"></i>Compare</button></div></div>
        </details>`;
    }).join("");
}
async function runMCQDuplicateFinder() {
    try {
        await Word.run(async (context) => {
            const selection = context.document.getSelection(); selection.load("text"); await context.sync();
            const text = selection.text || ""; if (!text.trim()) { showStatus("Please select MCQs.", true); return; }
            const mcqs = parseQuestions(text); if (mcqs.length < 2) { showStatus("Select at least two MCQs.", true); return; }
            const paragraphInfos = await dupReadWordParagraphs(context, selection);
            dupAttachWordMetadata(mcqs, paragraphInfos);
            const threshold = Number(document.getElementById("duplicateThreshold").value || 85);
            const opts = { ignoreNumbers: document.getElementById("dupIgnoreNumbers").checked, ignorePunctuation: document.getElementById("dupIgnorePunctuation").checked, ignoreOptionOrder: document.getElementById("dupIgnoreOptionOrder").checked, detectConflicts: document.getElementById("dupDetectConflicts").checked, protectNumbers: document.getElementById("dupProtectNumbers").checked, compareOptions: document.getElementById("dupCompareOptions").checked };
            const matches = []; const buckets = new Map();
            mcqs.forEach((q, i) => { const key = dupCandidateSignature(q, opts); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(i); });
            const compared = new Set();
            for (const indices of buckets.values()) {
                for (let x = 0; x < indices.length; x++) {
                    for (let y = x + 1; y < indices.length; y++) {
                        const a = indices[x], b = indices[y], key = a < b ? `${a}:${b}` : `${b}:${a}`;
                        if (compared.has(key)) continue; compared.add(key);
                        const analysis = dupSimilarity(mcqs[a], mcqs[b], opts);
                        if (analysis.exact || (opts.detectConflicts && analysis.answerConflict) || (analysis.score * 100) >= threshold) matches.push({a,b,analysis});
                    }
                }
            }
            const groups = dupMakeGroups(matches, mcqs.length);
            MCQ_DUPLICATE_STATE.results = groups; MCQ_DUPLICATE_STATE.mcqs = mcqs;
            document.getElementById("duplicateSummary").classList.remove("hidden");
            document.getElementById("dupExactCount").textContent = groups.filter(g => g.exact).length;
            document.getElementById("dupPotentialCount").textContent = groups.filter(g => !g.exact && !g.conflict).length;
            document.getElementById("dupConflictCount").textContent = groups.filter(g => g.conflict).length;
            document.getElementById("dupQuestionCount").textContent = mcqs.length;
            renderDuplicateFinderResults(groups, mcqs, threshold);
            showStatus(`Analysis completed: ${mcqs.length} MCQs scanned.`);
        });
    } catch (error) { showStatus("Duplicate Finder Error: " + (error.message || "Unknown error"), true); }
}
async function navigateToDuplicateQuestion(id) {
    const mcq = MCQ_DUPLICATE_STATE.mcqs[id]; if (!mcq) return;
    try {
        await Word.run(async (context) => {
            if (mcq.wordParagraphId && Office.context.requirements && Office.context.requirements.isSetSupported("WordApi", "1.6")) {
                const p = context.document.getParagraphByUniqueLocalId(mcq.wordParagraphId); p.select(); await context.sync(); return;
            }
            const searchText = dupNormalizeWhitespace(mcq.question).slice(0, 255);
            const ranges = context.document.body.search(searchText, {matchCase:false, matchWholeWord:false});
            ranges.load("items/text"); await context.sync();
            if (!ranges.items.length) { showStatus("Could not locate.", true); return; }
            ranges.items[Number.isInteger(mcq.wordDocumentOccurrence) ? Math.min(mcq.wordDocumentOccurrence, ranges.items.length - 1) : 0].select();
            await context.sync();
        });
    } catch (error) { showStatus("Navigation error.", true); }
}
function compareDuplicateQuestions(aId, bId) {
    const a = MCQ_DUPLICATE_STATE.mcqs[aId], b = MCQ_DUPLICATE_STATE.mcqs[bId]; if (!a || !b) return;
    const compareHtml = `<div id="duplicateComparePanel" class="fixed inset-x-3 top-16 bottom-3 bg-white border border-slate-300 rounded-xl shadow-2xl z-50 overflow-y-auto p-3.5 animate-[fadeIn_0.15s_ease-out]"><div class="flex items-center justify-between mb-2"><h3 class="text-xs font-bold uppercase tracking-wider text-slate-800"><i class="fas fa-columns mr-1 text-indigo-600"></i> Compare MCQs</h3><button onclick="document.getElementById('duplicateComparePanel').remove()" class="text-slate-400 hover:text-slate-800"><i class="fas fa-times"></i></button></div><div class="grid grid-cols-1 gap-2.5"><div class="border border-blue-200 rounded-lg p-2.5 bg-blue-50/40"><div class="text-xs font-bold text-blue-800 mb-1">Question A</div><div class="text-xs text-slate-700 dup-question-text">${dupEscapeHtml(a.question)}</div>${dupOptionTexts(a).map((x,i)=>`<div class="mt-1 text-[11px] text-slate-600">${OPTION_ORDER[i]||(i+1)+'.'} ${dupEscapeHtml(x)}</div>`).join('')}</div><div class="border border-purple-200 rounded-lg p-2.5 bg-purple-50/40"><div class="text-xs font-bold text-purple-800 mb-1">Question B</div><div class="text-xs text-slate-700 dup-question-text">${dupEscapeHtml(b.question)}</div>${dupOptionTexts(b).map((x,i)=>`<div class="mt-1 text-[11px] text-slate-600">${OPTION_ORDER[i]||(i+1)+'.'} ${dupEscapeHtml(x)}</div>`).join('')}</div></div></div>`;
    const old = document.getElementById("duplicateComparePanel"); if (old) old.remove(); document.body.insertAdjacentHTML("beforeend", compareHtml);
}

// --- QUESTION BANK LOGIC ---
function updateBankCount() {
    let bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
    let countEl = document.getElementById("bank-count");
    if (countEl) countEl.innerText = bank.length;
}

async function addSelectedToBank() {
    try {
        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            selection.load("text");
            await context.sync();
            const text = selection.text;
            if (!text || !text.trim()) { showStatus("Please select MCQs to add to Bank!", true); return; }
            let questions = parseQuestions(text);
            if (questions.length === 0) { showStatus("No valid questions found to add!", true); return; }
            let bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
            let added = 0;
            questions.forEach(q => {
                let exists = bank.find(bq => bq.question.trim() === q.question.trim());
                if (!exists) {
                    q.id = "mcq_" + Date.now().toString() + Math.random().toString(36).substr(2, 5);
                    q.addedOn = new Date().toISOString();
                    bank.push(q);
                    added++;
                }
            });
            localStorage.setItem("mcq_studio_bank", JSON.stringify(bank));
            updateBankCount();
            if(added > 0) { showStatus(`Added ${added} new MCQs to Bank!`); } else { showStatus(`Selected MCQs already exist in Bank!`, true); }
        });
    } catch (error) { showStatus("Error: " + (error.message || "Unknown"), true); }
}

function exportBankJSON() {
    let bankData = localStorage.getItem("mcq_studio_bank");
    if (!bankData || bankData === "[]") { showStatus("Bank is empty!", true); return; }
    let blob = new Blob([bankData], {type: "application/json"});
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = "Foliora_MCQ_Bank_Export.json";
    a.click();
    showStatus("Bank exported successfully!");
}

function importBankJSON(e) {
    let file = e.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function(evt) {
        try {
            let imported = JSON.parse(evt.target.result);
            if (!Array.isArray(imported)) throw new Error("Invalid format");
            let bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
            let added = 0;
            imported.forEach(q => {
                if (q.question && !bank.find(bq => bq.question.trim() === q.question.trim())) {
                    if (!q.id) q.id = "mcq_" + Date.now().toString() + Math.random().toString(36).substr(2, 5);
                    bank.push(q); added++;
                }
            });
            localStorage.setItem("mcq_studio_bank", JSON.stringify(bank));
            updateBankCount();
            showStatus(`Imported ${added} new MCQs!`);
        } catch (err) { showStatus("Error importing file! Invalid JSON.", true); }
        document.getElementById('importBankFile').value = '';
    };
    reader.readAsText(file);
}

function openBankViewer() {
    const old = document.getElementById("bankViewerPanel");
    if (old) old.remove();
    const panelHtml = `
    <div id="bankViewerPanel" class="fixed inset-x-3 top-16 bottom-3 bg-white border border-slate-300 rounded-xl shadow-2xl z-50 flex flex-col p-3.5 animate-[fadeIn_0.15s_ease-out]">
        <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-800"><i class="fas fa-database mr-1 text-emerald-600"></i> Foliora Question Bank</h3>
            <button onclick="document.getElementById('bankViewerPanel').remove()" class="text-slate-400 hover:text-red-500 transition"><i class="fas fa-times text-base"></i></button>
        </div>
        <div class="mb-2 relative">
            <input type="text" id="bankSearchInput" placeholder="Search questions or options..." class="w-full pl-8 p-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-emerald-400 outline-none bg-slate-50">
            <i class="fas fa-search absolute left-2.5 top-2.5 text-slate-400 text-xs"></i>
        </div>
        <div id="bankListContainer" class="flex-1 overflow-y-auto space-y-2 p-1"></div>
    </div>`;
    document.body.insertAdjacentHTML("beforeend", panelHtml);
    document.getElementById("bankSearchInput").addEventListener("input", (e) => renderBankItems(e.target.value));
    
    document.getElementById("bankListContainer").addEventListener("click", (e) => {
        const btn = e.target.closest(".bank-delete-btn");
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            deleteFromBank(btn.getAttribute("data-delete-bank-id"), btn);
        }
    });
    renderBankItems();
}

function renderBankItems(query = "") {
    let bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
    let idsChanged = false;
    bank.forEach((q, idx) => {
        if (!q.id) {
            q.id = "mcq_" + Date.now().toString(36) + "_" + idx + "_" + Math.random().toString(36).slice(2, 7);
            idsChanged = true;
        }
    });
    if (idsChanged) localStorage.setItem("mcq_studio_bank", JSON.stringify(bank));

    let container = document.getElementById("bankListContainer");
    if (query) {
        const lowerQ = query.toLowerCase();
        bank = bank.filter(q => q.question.toLowerCase().includes(lowerQ) || (q.options && q.options.some(o => o[1].toLowerCase().includes(lowerQ))));
    }
    if (bank.length === 0) {
        container.innerHTML = `<div class="text-center text-slate-400 text-xs mt-10"><i class="fas fa-box-open text-3xl mb-2 opacity-40"></i><br>${query ? "No questions match your search." : "Bank is empty. Add some MCQs!"}</div>`;
        return;
    }
    container.innerHTML = bank.slice().reverse().map((q, i) => {
        let optionsHtml = (q.options || [])
            .map((opt, idx) => {
                const label = OPTION_ORDER[idx] || ((idx + 1) + '.');
                const text = dupEscapeHtml(opt[1]);
                return `<div class="mt-0.5 text-slate-600">${label}${text}</div>`;
            })
            .join('');
        let answerHtml = q.answer ? `<div class="mt-1 font-semibold text-emerald-600 text-[11px]"><i class="fas fa-check-circle mr-1"></i>Ans: ${q.answer}</div>` : '';
        return `
        <div class="border border-slate-200 rounded-lg p-2.5 bg-slate-50/70 relative group hover:border-emerald-300 transition">
            <button type="button" data-delete-bank-id="${dupEscapeHtml(q.id)}" class="bank-delete-btn absolute top-2.5 right-2.5 text-slate-400 hover:text-red-500 transition" title="Delete MCQ"><i class="fas fa-trash-alt text-xs"></i></button>
            <div class="text-xs font-bold text-slate-800 dup-question-text pr-6">${dupEscapeHtml(q.question)}</div>
            <div class="text-[11px] mt-1.5">${optionsHtml}${answerHtml}</div>
        </div>`;
    }).join("");
}

function deleteFromBank(id, btnElement) {
    if (btnElement && btnElement.dataset.confirm !== "true") {
        btnElement.dataset.confirm = "true";
        btnElement.innerHTML = '<span class="text-[9px] font-bold text-red-600">Sure?</span>';
        setTimeout(() => {
            if(btnElement && btnElement.dataset.confirm === "true") {
                btnElement.dataset.confirm = "false";
                btnElement.innerHTML = '<i class="fas fa-trash-alt text-xs"></i>';
            }
        }, 3000);
        return;
    }
    let bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
    const before = bank.length;
    bank = bank.filter(q => String(q.id || "") !== String(id));
    if (bank.length === before) {
        showStatus("Could not find this MCQ in the Question Bank.", true);
        return;
    }
    localStorage.setItem("mcq_studio_bank", JSON.stringify(bank));
    updateBankCount();
    let searchInput = document.getElementById("bankSearchInput");
    renderBankItems(searchInput ? searchInput.value : "");
    showStatus("Question removed from Bank!");
}

// --- SET GENERATOR & EXAM PAPER GENERATOR ---
function mcqInsertSetOptionsWithAnswer(anchorRange, question, layout, optionFont, optionSize, targetFont, targetSize, origAlign, answerSize, useSymbols, isUnicode) {
    const count = Math.min(4, (question.options || []).length);
    let lastParagraph = null;

    const insertOptionRun = (paragraph, option, leadingTab) => {
        if (!option) return;
        const labelText = option[0] || "";
        const label = useSymbols ? (OPTION_EXPORT_MAP[labelText] || labelText) : getStandardOptionMarker(labelText, isUnicode);
        
        let text = String(option[1] || "").replace(/[\r\n\v]/g, " ").trim();
        text = text.replace(/\s+([PQRSK-N])\s*$/i, "").trim();

        if (leadingTab) {
            const r = paragraph.insertText("\t", "End");
            mcqApplyFontSafe(r, targetFont, targetSize, false, false);
        }
        const marker = paragraph.insertText(label, "End");
        mcqApplyFontSafe(marker, useSymbols ? optionFont : targetFont, useSymbols ? optionSize : targetSize, false, false);
        const body = paragraph.insertText(" " + text, "End");
        mcqApplyFontSafe(body, targetFont, targetSize, false, false);
    };

    if (layout.mode === "two-per-line") {
        for (let j = 0; j < count; j += 2) {
            const p = anchorRange.insertParagraph("", "Before");
            lastParagraph = p;
            p.alignment = origAlign;
            insertOptionRun(p, question.options[j], true);
            if (j + 1 < count) {
                const midTab = p.insertText("\t", "End");
                mcqApplyFontSafe(midTab, targetFont, targetSize, false, false);
                insertOptionRun(p, question.options[j + 1], false);
            }

            if (j + 2 >= count && question.answer) {
                const normalizedAnswer = mcqResolveAnswer(question);
                const ansMarker = useSymbols
                    ? (ANSWER_EXPORT_MAP[normalizedAnswer] || normalizedAnswer)
                    : (mcqBuildPreservedAnswerText(question, normalizedAnswer) || getStandardAnswerMarker(normalizedAnswer, isUnicode));
                const tab = p.insertText("\t", "End");
                mcqApplyFontSafe(tab, targetFont, targetSize, false, false);
                const ansRange = p.insertText(ansMarker, "End");
                mcqApplyFontSafe(ansRange, useSymbols ? "ProshnaP" : targetFont, useSymbols ? answerSize : targetSize, false, false);
            }
        }
    } else {
        for (let j = 0; j < count; j++) {
            const p = anchorRange.insertParagraph("", "Before");
            lastParagraph = p;
            p.alignment = origAlign;
            insertOptionRun(p, question.options[j], true);
            if (j === count - 1 && question.answer) {
                const normalizedAnswer = mcqResolveAnswer(question);
                const ansMarker = useSymbols
                    ? (ANSWER_EXPORT_MAP[normalizedAnswer] || normalizedAnswer)
                    : (mcqBuildPreservedAnswerText(question, normalizedAnswer) || getStandardAnswerMarker(normalizedAnswer, isUnicode));
                const tab = p.insertText("\t", "End");
                mcqApplyFontSafe(tab, targetFont, targetSize, false, false);
                const ansRange = p.insertText(ansMarker, "End");
                mcqApplyFontSafe(ansRange, useSymbols ? "ProshnaP" : targetFont, useSymbols ? answerSize : targetSize, false, false);
            }
        }
    }
    return lastParagraph;
}

async function generateMCQSet() {
    try {
        await Word.run(async (context) => {
            let bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
            if (!bank.length) { showStatus("Question Bank is empty! Add MCQs first.", true); return; }

            let count = parseInt(document.getElementById("set-count")?.value, 10) || 25;
            let startNum = parseInt(document.getElementById("set-start")?.value, 10) || 1;
            let setCount = parseInt(document.getElementById("set-number-of-sets")?.value, 10) || 1;
            const shuffleQ = !!document.getElementById("set-shuffle-q")?.checked;
            const shuffleO = !!document.getElementById("set-shuffle-o")?.checked;
            count = Math.max(1, Math.min(count, bank.length));
            setCount = Math.max(1, Math.min(setCount, 10));

            const selection = context.document.getSelection();
            selection.load("font/size");
            const selParas = selection.paragraphs;
            selParas.load("items");
            await context.sync();

            let origAlign = "Left";
            const origSize = selection.font.size || 10.5;
            let originalParagraph = null;
            if (selParas.items.length) {
                originalParagraph = selParas.items[0];
                originalParagraph.load("alignment");
                await context.sync();
                origAlign = originalParagraph.alignment || "Left";
            }

            const tabStops = originalParagraph ? await mcqReadSelectedParagraphTabStops(context, originalParagraph) : [];
            const columnWidth = await mcqGetCurrentColumnWidth(context);
            const isUnicode = bank.some(q => /[\u0980-\u09FF]/.test(String(q.question || "")));
            const targetFont = isUnicode ? "Kalpurush" : "SutonnyMJ";
            
            const optFont = (document.getElementById("norm-opt-font")?.value || "BanglaOMR").trim() || "BanglaOMR";
            const optSize = parseFloat(document.getElementById("norm-opt-size")?.value) || 9;
            const ansSize = parseFloat(document.getElementById("norm-ans-size")?.value) || 10;
            
            const setMarkerStyle = document.getElementById("set-marker-style");
            const useSymbols = !setMarkerStyle || setMarkerStyle.value !== "text";

            const anchorRange = selection.insertText("", "Replace");

            for (let setIdx = 0; setIdx < setCount; setIdx++) {
                if (setIdx > 0) anchorRange.insertBreak("Page", "Before");

                const setTitle = setCount > 1
                    ? (isUnicode ? `প্রশ্ন সেট ${toBanglaNumber(setIdx + 1)}` : `Question Set ${setIdx + 1}`)
                    : "";
                if (setTitle) {
                    const tp = anchorRange.insertParagraph(setTitle, "Before");
                    mcqApplyFontSafe(tp, targetFont, origSize + 2, true, false);
                    tp.alignment = "Centered";
                    anchorRange.insertParagraph("", "Before");
                }

                let pool = JSON.parse(JSON.stringify(bank));
                if (shuffleQ) {
                    for (let i = pool.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [pool[i], pool[j]] = [pool[j], pool[i]];
                    }
                }
                const selectedQs = pool.slice(0, count);

                for (let i = 0; i < selectedQs.length; i++) {
                    let q = JSON.parse(JSON.stringify(selectedQs[i]));
                    sanitizeQuestionAnswers(q);
                    if (shuffleO) q = shuffleOptions(q);

                    const qNum = startNum + i;
                    const qNumStr = isUnicode ? toBanglaNumber(qNum) : qNum;
                    const safeQuestion = String(q.question || "").replace(/[\r\n\v]/g, " ").trim();
                    const qPara = anchorRange.insertParagraph(`${qNumStr}.${safeQuestion}`, "Before");
                    mcqApplyFontSafe(qPara, targetFont, origSize, false, false);
                    qPara.alignment = origAlign;

                    const layout = mcqDetectAutoOptionLayout(q.options, tabStops, columnWidth, optFont, optSize, targetFont, origSize, false, useSymbols, isUnicode);
                    mcqInsertSetOptionsWithAnswer(anchorRange, q, layout, optFont, optSize, targetFont, origSize, origAlign, ansSize, useSymbols, isUnicode);
                }
            }

            await context.sync();
            showStatus(`${setCount} set${setCount > 1 ? "s" : ""} generated successfully with inline answers.`);
        });
    } catch (error) {
        showStatus("Error: " + (error.message || error.code || "Unknown"), true);
    }
}

async function generateExamPaper() {
    try {
        await Word.run(async (context) => {
            let bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
            if (bank.length === 0) { showStatus("Question Bank is empty! Add MCQs first.", true); return; }

            let title = document.getElementById("exam-title").value.trim() || "Exam Paper";
            let numSets = parseInt(document.getElementById("exam-sets").value) || 1;
            if (numSets < 1) numSets = 1;
            if (numSets > 10) numSets = 10;

            let doShuffle = document.getElementById("exam-shuffle").checked;
            let showKey = document.getElementById("exam-ans-key").checked;

            const selection = context.document.getSelection();
            selection.load("font/size");
            const selParas = selection.paragraphs;
            selParas.load("items");
            await context.sync();

            let origAlign = "Left";
            let origSize = selection.font.size || 10.5;
            let originalParagraph = null;

            if (selParas.items.length > 0) {
                originalParagraph = selParas.items[0];
                originalParagraph.load("alignment");
                await context.sync();
                origAlign = originalParagraph.alignment || "Left";
            }

            let tabStops = [];
            if (originalParagraph) {
                tabStops = await mcqReadSelectedParagraphTabStops(context, originalParagraph);
            }
            const columnWidth = await mcqGetCurrentColumnWidth(context);

            let isUnicode = /[\u0980-\u09FF]/.test(bank[0].question) || /[\u0980-\u09FF]/.test(title);
            let targetFont = isUnicode ? "Kalpurush" : "SutonnyMJ";
            
            let optFont = document.getElementById("norm-opt-font").value.trim() || "BanglaOMR";
            let optSize = parseFloat(document.getElementById("norm-opt-size").value.trim()) || 9;

            const examMarkerStyle = document.getElementById("exam-marker-style");
            const useSymbols = !examMarkerStyle || examMarkerStyle.value !== "text";

            let anchorRange = selection.insertText("", "Replace");
            const setLabelsBN = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ"];
            const setLabelsEN = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

            for (let setIdx = 0; setIdx < numSets; setIdx++) {
                let pool = JSON.parse(JSON.stringify(bank));

                if (doShuffle) {
                    for (let i = pool.length - 1; i > 0; i--) {
                        let j = Math.floor(Math.random() * (i + 1));
                        [pool[i], pool[j]] = [pool[j], pool[i]];
                    }
                }

                let answerKey = [];
                if (setIdx > 0) { anchorRange.insertBreak("Page", "Before"); }

                let setSuffix = numSets > 1 ? ` - ${isUnicode ? 'সেট ' + setLabelsBN[setIdx] : 'Set ' + setLabelsEN[setIdx]}` : "";
                let setTitle = title + setSuffix;

                let titlePara = anchorRange.insertParagraph(setTitle, "Before");
                mcqApplyFontSafe(titlePara, targetFont, origSize + 4, true, false);
                titlePara.alignment = "Centered";
                anchorRange.insertParagraph("", "Before");

                for (let i = 0; i < pool.length; i++) {
                    let q = pool[i];
                    
                    sanitizeQuestionAnswers(q);
                    if (doShuffle) q = shuffleOptions(q);

                    let currentNum = i + 1;
                    let qNumStr = isUnicode ? toBanglaNumber(currentNum) : currentNum;
                    let safeQuestion = q.question.replace(/[\r\n\v]/g, "").trim();
                    
                    let qPara = anchorRange.insertParagraph(`${qNumStr}.${safeQuestion}`, "Before");
                    mcqApplyFontSafe(qPara, targetFont, origSize, false, false);
                    qPara.alignment = origAlign;

                    const layout = mcqDetectAutoOptionLayout(
                        q.options, tabStops, columnWidth, optFont, optSize, targetFont, origSize, false, useSymbols, isUnicode
                    );

                    const count = Math.min(4, q.options.length);

                    if (layout.mode === "two-per-line") {
                        for (let j = 0; j < count; j += 2) {
                            const p = anchorRange.insertParagraph("", "Before");
                            p.alignment = origAlign;
                            
                            let tab1 = p.insertText("\t", "End");
                            mcqApplyFontSafe(tab1, targetFont, origSize, false, false);
                            
                            let mk1Label = useSymbols ? (OPTION_EXPORT_MAP[q.options[j][0]] || q.options[j][0]) : getStandardOptionMarker(q.options[j][0], isUnicode);
                            let mk1 = p.insertText(mk1Label, "End");
                            mcqApplyFontSafe(mk1, useSymbols ? optFont : targetFont, useSymbols ? optSize : origSize, false, false);
                            let txt1 = p.insertText(` ${q.options[j][1].trim()}`, "End");
                            mcqApplyFontSafe(txt1, targetFont, origSize, false, false);

                            if (q.options[j + 1]) {
                                let tab2 = p.insertText("\t", "End");
                                mcqApplyFontSafe(tab2, targetFont, origSize, false, false);
                                
                                let mk2Label = useSymbols ? (OPTION_EXPORT_MAP[q.options[j+1][0]] || q.options[j+1][0]) : getStandardOptionMarker(q.options[j+1][0], isUnicode);
                                let mk2 = p.insertText(mk2Label, "End");
                                mcqApplyFontSafe(mk2, useSymbols ? optFont : targetFont, useSymbols ? optSize : origSize, false, false);
                                let txt2 = p.insertText(` ${q.options[j+1][1].trim()}`, "End");
                                mcqApplyFontSafe(txt2, targetFont, origSize, false, false);
                            }
                        }
                    } else {
                        for (let j = 0; j < count; j++) {
                            const p = anchorRange.insertParagraph("", "Before");
                            p.alignment = origAlign;

                            let tab1 = p.insertText("\t", "End");
                            mcqApplyFontSafe(tab1, targetFont, origSize, false, false);
                            
                            let mk1Label = useSymbols ? (OPTION_EXPORT_MAP[q.options[j][0]] || q.options[j][0]) : getStandardOptionMarker(q.options[j][0], isUnicode);
                            let mk1 = p.insertText(mk1Label, "End");
                            mcqApplyFontSafe(mk1, useSymbols ? optFont : targetFont, useSymbols ? optSize : origSize, false, false);
                            let txt1 = p.insertText(` ${q.options[j][1].trim()}`, "End");
                            mcqApplyFontSafe(txt1, targetFont, origSize, false, false);
                        }
                    }
                    
                    if (q.answer) {
                        const ansMapUni = { "P": "ক", "Q": "খ", "R": "গ", "S": "ঘ", "K": "ক", "L": "খ", "M": "গ", "N": "ঘ", "A":"ক", "B":"খ", "C":"গ", "D":"ঘ", "ক":"ক", "খ":"খ", "গ":"গ", "ঘ":"ঘ" };
                        const ansMapBijoy = { "P": "K", "Q": "L", "R": "M", "S": "N", "ক": "K", "খ": "L", "গ": "M", "ঘ": "N", "K": "K", "L": "L", "M": "M", "N": "N" };
                        let norm = normalizeAnswerLabel(q.answer);
                        let finalAns = isUnicode ? (ansMapUni[norm] || norm) : (ansMapBijoy[norm] || norm);
                        answerKey.push(`${qNumStr}.${finalAns}`);
                    }
                }

                if (showKey && answerKey.length > 0) {
                    anchorRange.insertBreak("Page", "Before"); 
                    
                    let keyTitleStr = (isUnicode ? "উত্তরমালা" : "DËigvjv") + setSuffix;
                    let keyTitle = anchorRange.insertParagraph(keyTitleStr, "Before");
                    mcqApplyFontSafe(keyTitle, targetFont, origSize + 2, true, false);
                    keyTitle.alignment = "Centered";
                    anchorRange.insertParagraph("", "Before");

                    let cols = 5;
                    let rows = Math.ceil(answerKey.length / cols);
                    let tableData = [];
                    let ansIndex = 0;

                    for (let r = 0; r < rows; r++) {
                        let rowValues = [];
                        for (let c = 0; c < cols; c++) {
                            if (ansIndex < answerKey.length) {
                                rowValues.push(answerKey[ansIndex]);
                            } else {
                                rowValues.push(""); 
                            }
                            ansIndex++;
                        }
                        tableData.push(rowValues);
                    }

                    let ansTable = anchorRange.insertTable(rows, cols, "Before", tableData);
                    ansTable.style = "Table Grid";
                    let tblRange = ansTable.getRange();
                    mcqApplyFontSafe(tblRange, targetFont, origSize, false, false);
                    tblRange.alignment = "Centered";
                }
            }

            await context.sync();
            showStatus(`${numSets > 1 ? numSets + ' Sets of ' : ''}Exam Paper generated successfully!`);
        });
    } catch (error) { showStatus("Error: " + (error.message || "Unknown"), true); }
}



// --- BUTTON EVENT WIRING ---
let _eventsBound = false;

function bindAppEvents() {
    if (_eventsBound) return;
    _eventsBound = true;

    const bind = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.onclick = handler;
    };

    bind("btnNormal", async () => { setLoading("btnNormal", true); try { await formatSelectedText("normal"); } finally { setLoading("btnNormal", false); } });
    bind("btnSmart", async () => { setLoading("btnSmart", true); try { await formatSelectedText("smart"); } finally { setLoading("btnSmart", false); } });
    bind("btnFormatQuestions", async () => { setLoading("btnFormatQuestions", true); try { await formatQuestionsMacro(); } finally { setLoading("btnFormatQuestions", false); } });
    
    bind("btnUniToBijoy", async () => { await runSmartConverter("UniToBijoy"); });
    bind("btnBijoyToUni", async () => { await runSmartConverter("BijoyToUni"); });
    
    bind("btnFixEnglishFont", async () => { setLoading("btnFixEnglishFont", true); try { await fixEnglishFont(); } finally { setLoading("btnFixEnglishFont", false); } });
    bind("btnDuplicateFinder", async () => { setLoading("btnDuplicateFinder", true); try { await runMCQDuplicateFinder(); } finally { setLoading("btnDuplicateFinder", false); } });
    bind("btnAddBank", async () => { setLoading("btnAddBank", true); try { await addSelectedToBank(); } finally { setLoading("btnAddBank", false); } });

    bind("btnManageBank", () => openBankViewer());
    bind("btnExportBank", () => exportBankJSON());
    
    bind("btnClearBank", function() {
        const bank = JSON.parse(localStorage.getItem("mcq_studio_bank") || "[]");
        if (!bank.length) { showStatus("Question Bank is already empty.", true); return; }
        
        const btn = document.getElementById("btnClearBank");
        if (btn.dataset.confirming !== "true") {
            btn.dataset.originalHtml = btn.innerHTML;
            btn.innerHTML = `<span class="text-[9px] font-bold text-red-600 bg-red-50 px-1 rounded border border-red-200">Sure?</span>`;
            btn.dataset.confirming = "true";
            setTimeout(() => {
                if (btn) {
                    btn.innerHTML = btn.dataset.originalHtml;
                    btn.dataset.confirming = "false";
                }
            }, 3000);
            return;
        }

        localStorage.removeItem("mcq_studio_bank"); 
        updateBankCount();
        const container = document.getElementById("bankListContainer");
        if (container) renderBankItems(""); 
        
        btn.innerHTML = btn.dataset.originalHtml;
        btn.dataset.confirming = "false";
        showStatus("Question Bank cleared successfully!");
    });

    const importInput = document.getElementById("importBankFile");
    if (importInput) importInput.onchange = importBankJSON;

    bind("btnGenerateSet", async () => { setLoading("btnGenerateSet", true); try { await generateMCQSet(); } finally { setLoading("btnGenerateSet", false); } });
    bind("btnGenerateExam", async () => { setLoading("btnGenerateExam", true); try { await generateExamPaper(); } finally { setLoading("btnGenerateExam", false); } });

    const threshInput = document.getElementById("duplicateThreshold");
    if (threshInput) threshInput.addEventListener("input", (e) => { document.getElementById("duplicateThresholdValue").textContent = e.target.value + "%"; });

    loadFolioraPersistedState();
    initSupabase();
    checkLiveSession();

    document.getElementById('pnav-mcq').style.display = FOLIORA_STATE.workspace.mcq ? 'flex' : 'none';
    document.getElementById('pnav-converter').style.display = FOLIORA_STATE.workspace.converter ? 'flex' : 'none';
    document.getElementById('pnav-ocr').style.display = FOLIORA_STATE.workspace.ocr ? 'flex' : 'none';

    switchProduct('mcq');
    updateBankCount();
    applyMobileCommerceRestrictions();

}

if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
    Office.onReady(() => bindAppEvents());
} else {
    window.onload = bindAppEvents;
}

const visionFileInput = document.getElementById('vision-file-input');
const dropzone = document.getElementById('dropzone');
const visionPreviewContainer = document.getElementById('vision-preview-container');
const visionPreviewImg = document.getElementById('vision-preview');
const btnExtractText = document.getElementById('btnExtractText');
const btnRemoveImage = document.getElementById('btnRemoveImage');

function handleImageFile(file) {
    if(!file || !file.type.startsWith('image/')) {
        showStatus("Please provide a valid image file.", true);
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const result = e.target.result;
        visionPreviewImg.src = result;
        visionPreviewContainer.classList.remove("hidden");
        dropzone.classList.add("hidden");
        
        const parts = result.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        if (!mimeMatch || !parts[1]) {
            showStatus("Could not read the selected image.", true);
            return;
        }

        currentVisionImageMime = mimeMatch[1];
        currentVisionImageBase64 = parts[1];

        btnExtractText.disabled = false;
        btnExtractText.classList.remove("opacity-50", "cursor-not-allowed");
    };
    reader.readAsDataURL(file);
}

visionFileInput.addEventListener('change', (e) => { handleImageFile(e.target.files[0]); });

document.addEventListener('paste', (e) => {
    if(FOLIORA_STATE.activeProduct !== 'ocr') return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            handleImageFile(item.getAsFile());
        }
    }
});

dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('border-teal-500'); });
dropzone.addEventListener('dragleave', (e) => { e.preventDefault(); dropzone.classList.remove('border-teal-500'); });
dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.classList.remove('border-teal-500');
    if(e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0]);
});

btnRemoveImage.onclick = () => {
    currentVisionImageBase64 = null; currentVisionImageMime = null;
    visionPreviewImg.src = ""; visionPreviewContainer.classList.add("hidden"); dropzone.classList.remove("hidden");
    visionFileInput.value = ""; btnExtractText.disabled = true; btnExtractText.classList.add("opacity-50", "cursor-not-allowed");
};

btnExtractText.onclick = async () => {
    if (!currentVisionImageBase64 || !currentVisionImageMime) {
        showStatus("Please upload or paste an image first.", true);
        return;
    }
    if (currentVisionImageBase64.length > 12 * 1024 * 1024) {
        showStatus("This image is very large. Please use a smaller image.", true);
        return;
    }
    if (!supabaseClient || !FOLIORA_STATE.user || !FOLIORA_STATE.user.isLoggedIn) {
        showStatus("Please sign in to use AI OCR.", true);
        openAuthModal('signin');
        return;
    }

    setLoading("btnExtractText", true);

    try {
        // Always obtain the current Supabase session token before calling our
        // server-side OCR proxy. The Gemini API key never reaches the browser.
        const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (sessionError || !accessToken) {
            throw new Error("Your session has expired. Please sign in again.");
        }

        const response = await fetch("/api/ocr", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + accessToken
            },
            body: JSON.stringify({
                mimeType: currentVisionImageMime,
                data: currentVisionImageBase64
            })
        });

        const responseText = await response.text();
        let payload = null;
        try { payload = JSON.parse(responseText); } catch (e) {}

        if (!response.ok) {
            const message = payload?.error || `OCR server error (HTTP ${response.status})`;
            if (payload?.quota) {
                FOLIORA_STATE.ocrQuota.used = payload.quota.used;
                FOLIORA_STATE.ocrQuota.limit = payload.quota.limit;
                saveFolioraPersistedState();
                updateOcrQuotaDisplay();
            }
            throw new Error(message);
        }

        if (payload?.quota) {
            FOLIORA_STATE.ocrQuota.used = payload.quota.used;
            FOLIORA_STATE.ocrQuota.limit = payload.quota.limit;
            saveFolioraPersistedState();
            updateOcrQuotaDisplay();
        }

        let rawJsonOutput = payload?.text;
        if (!rawJsonOutput) throw new Error("AI returned an empty response.");
        rawJsonOutput = rawJsonOutput.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();

        let parsedDocument;
        try { parsedDocument = JSON.parse(rawJsonOutput); }
        catch (e) { throw new Error("Failed to parse AI output."); }

        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            let targetRange = selection.insertText("", "Replace");
            const items = parsedDocument?.document?.content || [];

            const insertLine = (text, size, isBold) => {
                if (!text) return;
                let lines = String(text).split('\n');
                let p = targetRange.insertParagraph(lines[0].trim(), "Before");
                p.font.name = "Kalpurush";
                p.font.size = size;
                p.font.bold = isBold;
                for (let i = 1; i < lines.length; i++) {
                    let brRange = p.insertText("\n" + lines[i].trim(), "End");
                    brRange.font.name = "Kalpurush";
                    brRange.font.size = size;
                    brRange.font.bold = isBold;
                }
            };

            for (const item of items) {
                if (item.type === "heading") insertLine(item.text, 14, true);
                else if (item.type === "paragraph") insertLine(item.text, 11, false);
                else if (item.type === "mcq") {
                    insertLine(`${item.serial ? item.serial + ' ' : ''}${item.question}`.trim(), 11, true);
                    if (item.options && Array.isArray(item.options)) {
                        for (const opt of item.options) {
                            insertLine(`${opt.label ? opt.label + ' ' : ''}${opt.text}`.trim(), 11, false);
                        }
                    }
                    if (item.answer && item.answer.text) {
                        insertLine(item.answer.text.startsWith("উত্তর") ? item.answer.text : `উত্তর: ${item.answer.text}`, 11, true);
                    }
                    if (item.explanation && item.explanation.text) {
                        insertLine(item.explanation.text.startsWith("ব্যাখ্যা") ? item.explanation.text : `ব্যাখ্যা: ${item.explanation.text}`, 11, false);
                    }
                }
            }

            targetRange.delete();
            await context.sync();
            showStatus("Smart AI Extraction Completed!");
        });
    } catch (error) {
        showStatus("Error: " + (error.message || "Unknown issue"), true);
    } finally {
        setLoading("btnExtractText", false);
    }
};

// --- তাৎক্ষণিক অ্যাপ ইনিশিয়ালাইজেশন (বাটনে ক্লিক ছাড়াই স্ক্রিন লোড হবে) ---
function startApp() {
    bindAppEvents();
    loadFolioraPersistedState();
    initSupabase();
    
    // অ্যাপ ওপেন হওয়া মাত্রই কোনো ক্লিক ছাড়াই তাৎক্ষণিকভাবে সঠিক স্টেট (লক স্ক্রিন বা মেইন অপশন) রেন্ডার করবে
    switchProduct('mcq');

    if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
        Office.onReady(() => {
            checkLiveSession();
        });
    } else {
        checkLiveSession();
    }
}

// DOM লোড হওয়ার সাথে সাথেই রান করবে
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp);
} else {
    startApp();
}
