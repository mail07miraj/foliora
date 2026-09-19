// ====================================================================
// FOLIORA ECOSYSTEM: CONFIGURATION & SUPABASE INITIALIZATION
// ====================================================================

const SUPABASE_CONFIG = {
    const SUPABASE_PROJECT_URL = localStorage.getItem('foliora_supabase_url') || "https://dajfssubdipeqnmedwxo.supabase.co";
    const SUPABASE_ANON_KEY    = localStorage.getItem('foliora_supabase_key') || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhamZzc3ViZGlwZXFubWVkd3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MTAxODEsImV4cCI6MjEwNDE4NjE4MX0.cGBFywbbksMXOX-uzhM0obEPDEyC31I64zQ9d-TBwrU";
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
        mcq: 'locked',     // ডাটাবেসে পেমেন্ট রেকর্ড ছাড়া ডিফল্ট LOCKED থাকবে
        converter: 'free',  // অলওয়েজ ফ্রি
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
    const url = SUPABASE_CONFIG.url !== "https://your-project.supabase.co"
        ? SUPABASE_CONFIG.url
        : localStorage.getItem('foliora_supabase_url');
        
    const key = SUPABASE_CONFIG.anonKey !== "your-anon-public-key"
        ? SUPABASE_CONFIG.anonKey
        : localStorage.getItem('foliora_supabase_key');

    if (url && key && window.supabase) {
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
        const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

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

    if (!supabaseClient) {
        showStatus("সুপাবেজ সংযোগ পাওয়া যায়নি। কনফিগারেশন চেক করুন।", true);
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
        
        // ডিফল্টভাবে locked রেখে ডাটাবেস থেকে সঠিক স্ট্যাটাস লোড করবে
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

// ====================================================================
// PRICING MODAL & CHECKOUT (DAY 6)
// ====================================================================
function openPricingModal() {
    closeProfileModal();
    document.getElementById('modalPricing').classList.remove('hidden');
}

function closePricingModal() {
    document.getElementById('modalPricing').classList.add('hidden');
}

function handleLockAction(productId) {
    if (!FOLIORA_STATE.user || !FOLIORA_STATE.user.isLoggedIn) {
        openAuthModal('signin');
    } else {
        openPricingModal();
    }
}

async function initiateCheckout(planId) {
    if (!FOLIORA_STATE.user || !FOLIORA_STATE.user.isLoggedIn) {
        closePricingModal();
        openAuthModal('signin');
        showStatus("প্ল্যান আপগ্রেড করতে অনুগ্রহ করে প্রথমে সাইন ইন করুন।", true);
        return;
    }

    const userId = FOLIORA_STATE.user.id;
    const userEmail = encodeURIComponent(FOLIORA_STATE.user.email);
    
    // আপনার ওয়েবসাইট বা পেমেন্ট চেকআউট পেজের লিঙ্ক
    const checkoutUrl = `https://foliora.com/checkout?user_id=${userId}&email=${userEmail}&plan=${planId}`;
    window.open(checkoutUrl, "_blank");

    closePricingModal();
    showStatus("পেমেন্ট সম্পন্ন হলে ওয়ার্ড-এ ফিরে আসুন, স্বয়ংক্রিয়ভাবে ফিচার আনলক হয়ে যাবে।");
}

// ব্যবহারকারী ব্রাউজারে পেমেন্ট দিয়ে Word-এ ফিরে আসলেই অটো-সিঙ্ক
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
    
    if (textEl) textEl.textContent = `${used} / ${limit} pages used`;
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
        'ন্ট':'›U', 'প্ট':'Þ', 'ষ্ক':'®‹', 'ল্ক':'é', 'ল্গ':'ê', 'ল্ড':'ì', 'শ্চ':'ð', 'স্কৃ':'¯‹…',
        'গ্ব':'M¦', 'ভু':'fz', 'খ্ব':'L¡', 'ক্ক':'°', 'ক্ট':'±', 'ক্ত':'³', 'ক্ব':'K¡', 'ক্স':'·', 'ক্ষ':'¶', 'ক্ষ্ম':'¶g', 'ক্ষ্য':'¶¨', 'ক্ষু':'¶z',
        'জ্ঞ':'Á', 'ঙ্ক':'¼', 'ঙ্খ':'¼L', 'ঙ্গ':'½', 'ঙ্ঘ':'½N', 'ট্ট':'Æ', 'ঠ্ঠ':'V&V', 'ড্ড':'Ç', 'ণ্ট':'È', 'ণ্ঠ':'É', 'ণ্ড':'Û', 'ন্ড':'Û',
        'ত্ত':'Ë', 'ত্থ':'Ì', 'ত্র':'Î', 'দ্দ':'Ï', 'দ্ধ':'×', 'দ্ব':'Ø', 'দ্ম':'Ù', 'ন্দ':'›`', 'ন্ধ':'Ü', 'ন্ন':'bœ', 'ন্ব':'b¦', 'ন্ম':'b¥', 'ন্দ্র':'›`«', 'দ্র':'`ª',
        'ম্প':'¤ú', 'ম্ব':'¤^', 'ম্ম':'¤§', 'ম্ভ':'¤¢', 'ন্স':'Ý', 'ত্ম':'Z¥', 'ত্ন':'Zœ', 'ত্ম্য':'Z¥¨', 'স্ট':'÷', 'ষ্ট':'ó', 'ষ্ঠ':'ô', 'ষ্ণ':'ò', 'ষ্প':'®ú', 'ষ্ফ':'®ù', 'ষ্ম':'®§',
        'স্ক':'¯‹', 'স্খ':'¯Œ', 'স্থ':'¯’', 'স্ন':'mœ', 'স্প':'¯ú', 'স্ফ':'ù', 'স্ম':'¯§', 'স্ব':'¯^', 'স্ত':'¯Í', 'স্স':'m&m',
        'হ্ম':'þ', 'হু':'û', 'হৃ':'ü', 'হ্ন':'ý', 'হ্ব':'nŸ', 'প্ত':'ß', 'ব্দ':'ã', 'ব্ধ':'ä', 'ব্ব':'e&e', 'ব্জ':'e&R',
        'শ্র':'kÖ', 'ক্র':'µ', 'গ্র':'MÖ', 'প্র':'cÖ', 'ড্র':'W«', 'ট্র':'U«', 'ফ্র':'d«', 'ব্র':'eª',
        'ব্ল':'eø', 'ক্ল':'K¬', 'গ্ল':'Mø', 'প্ল':'cø', 'ফ্ল':'d¬', 'ম্ল':'gø', 'শ্ল':'kø', 'স্ল':'mø', 'হ্ল':'n&j',
        'ঞ্চ':'Â', 'ঞ্ছ':'Ã', 'ঞ্জ':'Ä', 'রু':'iæ', 'রূ':'i~', 'শু':'ï', 'গু':'¸', 'ন্তু':'š‘', 'স্তু':'¯‘',
        'চ্চ':'”P', 'চ্ছ':'”Q', 'জ্জ':'¾', 'ঝ্ঝ':'S&S', 'দ্ঘ':'`&N', 'ন্ত':'šÍ', 'ন্থ':'š’', 'ল্প':'í', 'ল্ব':'j&e', 'ল্ম':'j&g', 'ল্ল':'jø', 'ল্ফ':'j&d',
        'ধ্ব':'aŸ', 'শ্ব':'k¦', 'ত্ব':'Z¡', 'থ্ব':'_¡', 'ম্ন':'gœ', 'শ্ম':'k&g', 'দ্য':'`¨', 'ন্ত্র':'š¿', 'ম্প্র':'¤cÖ', 'স্থ্য':'¯’¨', 'ষ্ট্র':'ó«', 
        'শ্ন':'kœ', 'ব্য':'e¨', 'স্ত্র':'¯¿', 'ত্ত্ব':'Ë¡', 'ন্দ্ব':'›Ø', 'প্ন':'cœ', 'ত্য':'Z¨', 'স্ক্র':'¯‹«', 'স্ট্র':'÷«', 'থ্র':'_«', 'প্প':'c&c', 'প্স':'c&m',
        'ঙ্ক্ষ':'¼¶', 'ঙ্ম':'O&g', 'গ্ধ':'\xBB', '্য':'¨', '্র':'«', '্':'&',
        'কু':'Kz', 'কূ':'K‚', 'চু':'Pz', 'চূ':'P‚', 'ঝু':'Sz', 'ঝূ':'S‚', 'তু':'Zz', 'তূ':'Z‚', 'ভূ':'f‚', 'কৃ':'K…', 'তৃ':'Z…',
        'ত্যু':'Zz¨', 'প্যু':'cz¨', 'ফ্যু':'dz¨', 'ভ্যু':'fz¨', 'হ্যু':'n~¨', 'ক্যু':'Ky¨', 'গ্যু':'My¨', 'চ্যু':'Py¨', 'জ্যু':'Ry¨', 'ড্যু':'Wy¨', 'দ্যু':'`y¨', 'ধ্যু':'ay¨', 'ব্যু':'ey¨', 'ল্যু':'jy¨', 'শ্যু':'k~¨', 'ত্যূ':'Z‚¨'
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
    let str = text.replace(/[\u200B-\u200D\uFEFF\+]/g, "");

    const b2uJukta = {
        '›U':'ন্ট', 'Þ':'প্ট', '®‹':'ষ্ক', 'é':'ল্ক', 'ê':'ল্গ', 'ì':'ল্ড', 'ð':'শ্চ', '¯‹…':'স্কৃ',
        'M¦':'গ্ব', 'fz':'ভু', 'L¡':'খ্ব', '°':'ক্ক', '±':'ক্ট', '³':'ক্ত', 'K¡':'ক্ব',
        '·':'ক্স', '¶':'ক্ষ', '²':'ক্ষ্ম', '¶¨':'ক্ষ্য', '¶z':'ক্ষু',
        'Á':'জ্ঞ', '¼':'ঙ্ক', '¼L':'ঙ্খ', '½':'ঙ্গ', '½N':'ঙ্ঘ', 'Æ':'ট্ট', 'Ç':'ড্ড',
        'È':'ণ্ট', 'É':'ণ্ঠ', 'Û':'ণ্ড', '\xDB':'ণ্ড',
        'Ë':'ত্ত', 'Ì':'ত্থ', 'Î':'ত্র', 'Ï':'দ্দ', '×':'দ্ধ', 'Ø':'দ্ব', 'Ù':'দ্ম',
        '›`':'ন্দ', 'Ü':'ন্ধ', 'bœ':'ন্ন', 'b¦':'ন্ব', 'b¥':'ন্ম', '›`«':'ন্দ্র', '`ª':'দ্র',
        '¤ú':'ম্প', '¤^':'ম্ব', '¤§':'ম্ম', '¤¢':'ম্ভ', 'Ý':'ন্স', 'Z¥':'ত্ম', 'Zœ':'ত্ন',
        'Z¥¨':'ত্ম্য', '÷':'স্ট', 'ó':'ষ্ট', 'ô':'ষ্ঠ', 'ò':'ষ্ণ', '®ú':'ষ্প', '®ù':'ষ্ফ',
        '®§':'ষ্ম', '¯‹':'স্ক', '¯Œ':'স্খ', '¯’':'স্থ', 'mœ':'স্ন', '¯ú':'স্প', 'ù':'স্ফ',
        '¯§':'স্ম', '¯^':'স্ব', '¯Í':'স্ত', 'm&m':'স্স',
        'þ':'হ্ম', 'û':'হু', 'ü':'হৃ', 'ý':'হ্ন', 'nŸ':'হ্ব', 'ß':'প্ত', 'ã':'ব্দ',
        'ä':'ব্ধ', 'e&e':'ব্ব', 'e&R':'ব্জ',
        'kÖ':'শ্র', 'µ':'ক্র', 'MÖ':'গ্র', 'cÖ':'প্র', 'W«':'ড্র', 'U«':'ট্র',
        'd«':'ফ্র', 'eª':'ব্র',
        'eø':'ব্ল', 'K¬':'ক্ল', 'Mø':'গ্ল', 'cø':'প্ল', 'd¬':'ফ্ল', 'gø':'ম্ল',
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
        'Zz':'তু', 'Z‚':'তূ', 'f‚':'ভূ', 'K…':'কৃ', 'Z…':'তৃ',
        'Zz¨':'ত্যু', 'cz¨':'প্যু', 'dz¨':'ফ্যু', 'fz¨':'ভ্যু', 'n~¨':'হ্যু',
        'Ky¨':'ক্যু', 'My¨':'গ্যু', 'Py¨':'চ্যু', 'Ry¨':'জ্যু', 'Wy¨':'ড্যু',
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
                let protectedEng = [];
                let protectRegex = /(\([A-Za-z0-9\s\-\.\_]+\)|\[[A-Za-z0-9\s\-\.\_]+\]|"[A-Za-z0-9\s\-\.\_]+"|'[A-Za-z0-9\s\-\.\_]+')/g;
                let safeText = rawText.replace(protectRegex, function(match) { 
                    protectedEng.push(match); 
                    return "▲" + (protectedEng.length - 1) + "▲"; 
                });

                let converted = convertBijoyToUnicode(safeText);
                let chunkRegex = /([ \t\r\n\v\(\)\[\]\{\}\'\"‘“’”\.\,\:\;\!\?\-\/\$\%\+\=\<\>°_@#&\*\\]+)/g;
                let textChunks = converted.split(/(▲\d+▲)/g);

                for (let i = 0; i < textChunks.length; i++) {
                    let chunk = textChunks[i];
                    if (!chunk) continue;
                    
                    let match = chunk.match(/^▲(\d+)▲$/);
                    if (match) {
                        let engText = protectedEng[parseInt(match[1])];
                        let rng = cursor.insertText(engText, "Before");
                        rng.font.name = "Times New Roman"; 
                        rng.font.size = finalFontSize; 
                        rng.font.bold = origBold; 
                        rng.font.italic = origItalic;
                    } else {
                        let subChunks = chunk.split(chunkRegex);
                        for (let j = 0; j < subChunks.length; j++) {
                            let subChunk = subChunks[j];
                            if (!subChunk) continue;
                            let rng = cursor.insertText(subChunk, "Before");
                            if (/[^\s]/.test(subChunk)) { 
                                rng.font.name = finalFontName; 
                            }
                            rng.font.size = finalFontSize; 
                            rng.font.bold = origBold; 
                            rng.font.italic = origItalic;
                        }
                    }
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

// --- ENGLISH FONT FIXER ENGINE ---
async function fixEnglishFont() {
    try {
        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            selection.load("text");
            await context.sync();

            const rawText = selection.text;
            if (!rawText || !rawText.trim()) { showStatus("Please select text first!", true); return; }

            let fixFontName = document.getElementById("fix-font").value.trim() || "Times New Roman";
            let fixFontSize = document.getElementById("fix-size").value.trim();

            const chunkRegex = /[ \t\(\)\[\]\{\}\'\"‘“’”\.\,\:\;\!\?\-\/\$\%\+\=\<\>°_@#&\*\\a-zA-Z0-9]+/g;
            let matches = rawText.match(chunkRegex);
            if (!matches) { showStatus("No English text found.", false); return; }

            let uniqueMatches = [...new Set(matches)].filter(m => /[a-zA-Z0-9]/.test(m)).map(m => m.length > 255 ? m.substring(0, 255) : m).sort((a, b) => b.length - a.length);

            for (let i = 0; i < uniqueMatches.length; i++) {
                let chunk = uniqueMatches[i];
                let searchResults = selection.search(chunk, { matchCase: true });
                searchResults.load("items/font/name");
                await context.sync();

                for (let j = 0; j < searchResults.items.length; j++) {
                    let item = searchResults.items[j];
                    if (item.font.name === "BanglaOMR" || item.font.name === "ProshnaP") continue;
                    if (item.font.name) {
                        item.font.name = fixFontName;
                        if(fixFontSize !== "") item.font.size = parseFloat(fixFontSize);
                    } else {
                        let chars = item.search("?", { matchWildcards: true });
                        chars.load("items/font/name");
                        await context.sync();
                        for (let k = 0; k < chars.items.length; k++) {
                            if (chars.items[k].font.name !== "BanglaOMR" && chars.items[k].font.name !== "ProshnaP") {
                                chars.items[k].font.name = fixFontName;
                                if(fixFontSize !== "") chars.items[k].font.size = parseFloat(fixFontSize);
                            }
                        }
                    }
                }
            }
            await context.sync();
            showStatus("English text fonts fixed safely!");
        });
    } catch (error) { showStatus("Error: " + (error.message || "Unknown"), true); }
}

// --- MCQ PARSER & SHUFFLE ---
function sanitizeQuestionAnswers(q) {
    if (!q || !q.options) return;
    for (let j = 0; j < q.options.length; j++) {
        let text = q.options[j][1];
        if (typeof text === "string") {
            const match = text.match(/\s+([PQRS])\s*$/i);
            if (match) {
                q.options[j][1] = text.replace(/\s+([PQRS])\s*$/i, "").trim();
                if (!q.answer) {
                    const map = { "P": "ক", "Q": "খ", "R": "গ", "S": "ঘ" };
                    q.answer = map[match[1].toUpperCase()];
                    q.original_answer = q.answer;
                }
            }
        }
    }
}

function parseQuestions(text) {
    let cleanText = String(text || "").replace(/([\r\n\v]+)/g, "\n");
    let lines = cleanText.split('\n');
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
        let line = lines[i].trim();
        if (!line) continue;

        let expMatch = line.match(/^\s*(?:ব্যাখ্যা|Explanation|e¨vL¨v)\s*[: \-\u2013\u2014]\s*(.+)$/i);
        if (expMatch && current) { current.explanation = expMatch[1].trim(); continue; }

        let ansMatch = line.match(/^\s*(?:সঠিক উত্তর|উত্তর|উ|Ans|Answer|mwVK DËi|DËi)\s*[:\. ]?\s*(.*)$/i);
        if (ansMatch && current) {
            let ansExtr = ansMatch[1].match(/[\(\[]?([ক-ঘA-DK-Na-dk-n])[\)\]]?/);
            if (ansExtr) {
                current.answer = normalizeAnswerLabel(ansExtr[1]);
                current.original_answer = current.answer;
            }
            continue;
        }

        let qMatch = line.match(/^\s*((?:\d+|[০-৯]+))\s*[\. \)\]]\s*(.*)$/);
        if (qMatch || /^[^\(]+?\?$/.test(line)) {
            flush();
            let rawQ = qMatch ? qMatch[2] : line;
            let optPattern = /([ক-ঘK-N])[\.\) :]\s*(.+?)(?=\s+[ক-ঘK-N][\.\) :]|$)/g;
            let optionsFound = [];
            let questionText = rawQ;
            
            let firstOptIndex = rawQ.search(/(?:\s+|^)([ক-ঘK-N])[\.\) :]/);
            if(firstOptIndex !== -1) {
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
        let optPattern = /([ক-ঘK-N])[\.\) :]\s*(.+?)(?=\s+[ক-ঘK-N][\.\) :]|$)/g;
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
    
    let text = String(option[1] || "").replace(/[\r\n\v]/g, " ").trim();
    const match = text.match(/\s+([PQRS])\s*$/i);
    if (match) text = text.replace(/\s+([PQRS])\s*$/i, "").trim();
    
    if (leadingTab) {
        let tabRange = paragraph.insertText("\t", "End");
        mcqApplyFontSafe(tabRange, targetFont, targetSize, false, false);
    }
    
    const markerRange = paragraph.insertText(label, "End");
    mcqApplyFontSafe(markerRange, useSymbols ? optionFont : targetFont, useSymbols ? optionSize : targetSize, origBold, origItalic);
    
    const textRange = paragraph.insertText(` ${text}`, "End");
    mcqApplyFontSafe(textRange, targetFont, targetSize, origBold, origItalic);
}

function mcqInsertNormalAnswer(paragraph, answer, answerSize, origItalic, useSymbols, targetFont, targetSize, isUnicode) {
    if (!answer) return;
    const marker = useSymbols ? (ANSWER_EXPORT_MAP[answer] || answer) : getStandardAnswerMarker(answer, isUnicode);
    paragraph.insertText("\t", "End");
    const answerRange = paragraph.insertText(marker, "End");
    mcqApplyFontSafe(answerRange, useSymbols ? "ProshnaP" : targetFont, useSymbols ? answerSize : targetSize, false, origItalic);
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
            if (j + 1 >= 3 || j + 1 === count - 1) {
                if (j + 1 === 3) mcqInsertNormalAnswer(paragraph, question.answer, answerSize, origItalic, useSymbols, targetFont, targetSize, isUnicode);
            }
        }
    } else {
        for (let j = 0; j < count; j++) {
            const paragraph = anchorRange.insertParagraph("", "Before");
            paragraph.alignment = origAlign;
            
            mcqInsertOption(paragraph, question.options[j], optionFont, optionSize, targetFont, targetSize, origBold, origItalic, true, useSymbols, isUnicode);
            if (j === 3) mcqInsertNormalAnswer(paragraph, question.answer, answerSize, origItalic, useSymbols, targetFont, targetSize, isUnicode);
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

            let origAlign = "Left", origBold = false, origItalic = false, originalParagraph = null;
            if (paragraphs.items.length) {
                originalParagraph = paragraphs.items[0];
                originalParagraph.load("alignment, font/bold, font/italic");
                await context.sync();
                origAlign = originalParagraph.alignment || "Left";
                origBold = originalParagraph.font.bold === true;
                origItalic = originalParagraph.font.italic === true;
            }
            
            selection.load("text, font/size");
            await context.sync();
            const text = selection.text || "";
            const origSize = Number(selection.font.size) || 10.5;
            
            if (!text.trim()) { showStatus("Please select some text in the document first!", true); return; }
            let tabStops = [];
            if (originalParagraph) tabStops = await mcqReadSelectedParagraphTabStops(context, originalParagraph);
            const columnWidth = await mcqGetCurrentColumnWidth(context);
            
            const isUnicode = /[\u0980-\u09FF]/.test(text);
            const targetFont = isUnicode ? "Kalpurush" : "SutonnyMJ";
            
            let questions = parseQuestions(text);
            if (!questions.length) { showStatus("No valid questions found in selection!", true); return; }
            
            const shuffleElement = document.getElementById("shuffleCheck");
            if (shuffleElement && shuffleElement.checked) questions = questions.map(q => shuffleOptions(q));
            
            const normStyle = document.getElementById("norm-marker-style");
            const smartStyle = document.getElementById("smart-marker-style");
            const useSymbols = type === "normal" 
                ? (!normStyle || normStyle.value !== "text") 
                : (!smartStyle || smartStyle.value !== "text");

            const optFontElement = document.getElementById("norm-opt-font");
            const optSizeElement = document.getElementById("norm-opt-size");
            const normalAnswerElement = document.getElementById("norm-ans-size");
            const smartAnswerElement = document.getElementById("smart-ans-size");
            
            const optionFont = optFontElement && optFontElement.value.trim() ? optFontElement.value.trim() : "BanglaOMR";
            const optionSize = optSizeElement && parseFloat(optSizeElement.value) > 0 ? parseFloat(optSizeElement.value) : 9;
            const normalAnswerSize = normalAnswerElement && parseFloat(normalAnswerElement.value) > 0 ? parseFloat(normalAnswerElement.value) : 10;
            const smartAnswerSize = smartAnswerElement && parseFloat(smartAnswerElement.value) > 0 ? parseFloat(smartAnswerElement.value) : 10;
            
            const anchorRange = selection.insertText(" ", "Replace");
            
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                const safeQuestion = String(q.question || "").replace(/[\r\n\v]/g, " ").trim();
                const qNum = isUnicode ? toBanglaNumber(i + 1) : i + 1;
                
                const qPara = anchorRange.insertParagraph(`${qNum}. ${safeQuestion}`, "Before");
                mcqApplyFontSafe(qPara, targetFont, origSize, origBold, origItalic);
                qPara.alignment = origAlign;
                
                const layout = mcqDetectAutoOptionLayout(q.options, tabStops, columnWidth, optionFont, optionSize, targetFont, origSize, origBold, useSymbols, isUnicode);
                
                if (type === "normal") {
                    mcqInsertNormalOptions(anchorRange, q, layout, optionFont, optionSize, targetFont, origSize, origAlign, origBold, origItalic, normalAnswerSize, useSymbols, isUnicode);
                    mcqInsertNormalExplanation(anchorRange, q.explanation, isUnicode, targetFont, origSize, origAlign, origBold, origItalic);
                } else if (type === "smart") {
                    mcqInsertSmartOptions(anchorRange, q, layout, optionFont, optionSize, targetFont, origSize, origAlign, origBold, origItalic, useSymbols, isUnicode);
                }
            }
            if (type === "smart") mcqInsertSmartAnswerPage(anchorRange, questions, isUnicode, targetFont, origSize, origAlign, origBold, origItalic, smartAnswerSize, useSymbols);
            
            anchorRange.delete();
            await context.sync();
            showStatus(`${questions.length} MCQs formatted successfully!`);
        });
    } catch (error) { showStatus("Error: " + (error.message || "Unknown error"), true); }
}

async function formatQuestionsMacro() {
    try {
        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            const paragraphs = selection.paragraphs;
            paragraphs.load("items");
            await context.sync();
            
            if (paragraphs.items.length === 0) { showStatus("Please select text first.", true); return; }
            
            let numStyle = document.getElementById("num-style").value;
            let matchingParagraphs = [];
            for (let i = 0; i < paragraphs.items.length; i++) { paragraphs.items[i].load("text"); }
            await context.sync();
            
            for (let i = 0; i < paragraphs.items.length; i++) {
                let p = paragraphs.items[i];
                let text = p.text.trim();
                if (text.length < 2) continue;
                if (/^\s*\(?[কখগঘA-D]\)?[\.\)।:]\s+/i.test(text)) continue;
                if (/^\s*(?:সঠিক উত্তর|উ|উত্তর|Ans|Answer|mwVK DËi|DËi|ব্যাখ্যা|Explanation|e¨vL¨v)/i.test(text)) continue;
                
                let hasNumber = /^\s*(?:\d+|[০-৯]+|[a-zA-Z]|[iIvVxXlLcCdDmMoO]+)\s*[\.\)।]/.test(text);
                let lastChar = text.slice(-1);
                let endsWithPunctuation = ["?", "؟", "—", "-", ":"].includes(lastChar);
                
                if (hasNumber || endsWithPunctuation || text.includes("?")) matchingParagraphs.push(p);
            }

            if (matchingParagraphs.length === 0) { showStatus("No questions detected.", true); return; }

            if (numStyle.startsWith("auto-")) {
                let list = matchingParagraphs[0].startNewList();
                list.load("id");
                await context.sync();
                
                let listLevelType = Word.ListNumbering.arabic;
                if (numStyle === "auto-roman") listLevelType = Word.ListNumbering.lowerRoman;
                if (numStyle === "auto-alpha") listLevelType = Word.ListNumbering.lowerLetter;
                
                list.setLevelNumbering(0, listLevelType);
                
                for (let i = 0; i < matchingParagraphs.length; i++) {
                    let p = matchingParagraphs[i];
                    p.font.bold = true;
                    if (i > 0) p.attachToList(list.id, 0);
                }
                await context.sync();
            } else {
                let qCount = 0;
                for (let i = 0; i < matchingParagraphs.length; i++) {
                    let p = matchingParagraphs[i];
                    p.font.bold = true; 
                    
                    let text = p.text.trim();
                    let hasNumber = /^\s*(?:\d+|[০-৯]+|[a-zA-Z]|[iIvVxXlLcCdDmMoO]+)\s*[\.\)।]/.test(text);
                    
                    if (!hasNumber) {
                        let numText = getSequenceString(qCount, numStyle);
                        let numRange = p.insertText(numText, "Start");
                        numRange.font.bold = true;
                    }
                    qCount++;
                }
                await context.sync();
            }
            showStatus(`Numbered and Bolded ${matchingParagraphs.length} Questions!`);
        });
    } catch (error) { showStatus("Error: " + (error.message || "Unknown"), true); }
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
        text = text.replace(/\s+([PQRS])\s*$/i, "").trim();

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
                const ansMarker = useSymbols ? (ANSWER_EXPORT_MAP[question.answer] || question.answer) : getStandardAnswerMarker(question.answer, isUnicode);
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
                const ansMarker = useSymbols ? (ANSWER_EXPORT_MAP[question.answer] || question.answer) : getStandardAnswerMarker(question.answer, isUnicode);
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
    
    bind("btnUniToBijoy", async () => { setLoading("btnUniToBijoy", true); try { await runSmartConverter("UniToBijoy"); } finally { setLoading("btnUniToBijoy", false); } });
    bind("btnBijoyToUni", async () => { setLoading("btnBijoyToUni", true); try { await runSmartConverter("BijoyToUni"); } finally { setLoading("btnBijoyToUni", false); } });
    
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

    const savedKey = localStorage.getItem("gemini_api_key");
    const keyInput = document.getElementById("gemini-api-key");
    if (keyInput && savedKey) keyInput.value = savedKey;
}

if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
    Office.onReady(() => bindAppEvents());
} else {
    window.onload = bindAppEvents;
}

document.getElementById("btnSaveApiKey").onclick = () => {
    const key = document.getElementById("gemini-api-key").value.trim();
    if(key) {
        localStorage.setItem("gemini_api_key", key);
        showStatus("API Key Saved!");
        toggleSettings("api-key-settings");
    } else {
        localStorage.removeItem("gemini_api_key");
        showStatus("API Key Removed!");
    }
};

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
    let apiKey = localStorage.getItem("gemini_api_key");
    if(!apiKey) { 
        showStatus("Please save your Gemini API Key first!", true); 
        toggleSettings('api-key-settings'); 
        return; 
    }
    if (!currentVisionImageBase64 || !currentVisionImageMime) { 
        showStatus("Please upload or paste an image first.", true); 
        return; 
    }
    if (currentVisionImageBase64.length > 12 * 1024 * 1024) { 
        showStatus("This image is very large. Please use a smaller image.", true); 
        return; 
    }

    setLoading("btnExtractText", true);

    if (supabaseClient && FOLIORA_STATE.user && FOLIORA_STATE.user.isLoggedIn) {
        try {
            const { data: quotaAuth, error: rpcError } = await supabaseClient.rpc('consume_ocr_page');

            if (rpcError) {
                showStatus("Server verification failed: " + rpcError.message, true);
                setLoading("btnExtractText", false);
                return;
            }

            if (!quotaAuth.allowed) {
                showStatus("Monthly OCR limit reached (" + quotaAuth.used + "/" + quotaAuth.limit + "). Please upgrade your plan.", true);
                FOLIORA_STATE.ocrQuota.used = quotaAuth.used;
                FOLIORA_STATE.ocrQuota.limit = quotaAuth.limit;
                updateOcrQuotaDisplay();
                switchProduct('ocr');
                setLoading("btnExtractText", false);
                return;
            }

            FOLIORA_STATE.ocrQuota.used = quotaAuth.used;
            FOLIORA_STATE.ocrQuota.limit = quotaAuth.limit;
            saveFolioraPersistedState();
            updateOcrQuotaDisplay();

        } catch (e) {
            showStatus("Error verifying quota with server.", true);
            setLoading("btnExtractText", false);
            return;
        }
    } else {
        if (FOLIORA_STATE.ocrQuota.used >= FOLIORA_STATE.ocrQuota.limit) {
            showStatus("Monthly OCR quota reached! Please sign in or upgrade.", true);
            switchProduct('ocr');
            setLoading("btnExtractText", false);
            return;
        }
        FOLIORA_STATE.ocrQuota.used += 1;
        saveFolioraPersistedState();
        updateOcrQuotaDisplay();
    }

    try {
        const prompt = `You are the document understanding and formatting engine of Foliora OCR Studio.

Your job is to analyze user-provided documents, images, PDFs, screenshots, clipboard text, and other extracted text, then reconstruct the content while preserving the original document's structure, order, wording, and formatting relationships.

==================================================
CORE PRINCIPLE
==================================================
The original document is the source of truth.
Do not rewrite, summarize, improve, correct, reorder, or reinterpret the content.
Extract and reconstruct the content exactly as it appears in the source as much as possible.
Preserve: Original wording, Original Bangla text, Bangla conjunct characters, Names, Numbers, Question numbering, Option labels, Punctuation, Mathematical expressions, Symbols, English words, Headings, Paragraphs, Lists, Tables, Line/section relationships, Original content order.
Never invent missing content.
Never silently correct uncertain OCR.
If a character or word is uncertain, preserve the closest readable source text and mark the uncertainty.

==================================================
MCQ DETECTION & STRUCTURE
==================================================
If the document contains MCQs, identify them as MCQs.
An MCQ normally contains: 1. Question serial/number, 2. Question text, 3. Multiple options, 4. Correct answer, 5. Optional explanation.

For every detected MCQ:
- Preserve the original question serial number exactly as it appears.
- Preserve the original question and option text/labels exactly.
- Do NOT shuffle options or renumber questions.

When converting an MCQ into structured content, maintain this logical order:
QUESTION -> OPTIONS -> ANSWER -> EXPLANATION (if present)

==================================================
OUTPUT FORMAT (JSON ONLY)
==================================================
Return valid JSON only. Do not wrap in markdown \`\`\`json.
Use this exact structure:
{
  "document": {
    "title": "",
    "content": [
      {
        "type": "heading",
        "text": "",
        "confidence": "high"
      },
      {
        "type": "paragraph",
        "text": "",
        "confidence": "high"
      },
      {
        "type": "mcq",
        "serial": "",
        "question": "",
        "options": [
          { "label": "", "text": "" }
        ],
        "answer": { "text": "", "confidence": "high" },
        "explanation": { "text": "", "confidence": "high" },
        "confidence": "high"
      }
    ]
  }
}
If answer or explanation does not exist, use null.`;

        const requestBody = {
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: currentVisionImageMime, data: currentVisionImageBase64 } }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify(requestBody) 
        });
        const responseText = await response.text();

        if (!response.ok) {
            let errorMsg = `HTTP Error ${response.status}`;
            try { errorMsg = JSON.parse(responseText).error?.message || errorMsg; } catch(e) { }
            throw new Error(errorMsg);
        }

        let rawJsonOutput = JSON.parse(responseText).candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJsonOutput) throw new Error("AI returned an empty response.");
        rawJsonOutput = rawJsonOutput.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

        let parsedDocument;
        try { parsedDocument = JSON.parse(rawJsonOutput); } catch(e) { throw new Error("Failed to parse AI output."); }

        await Word.run(async (context) => {
            const selection = context.document.getSelection();
            let targetRange = selection.insertText("", "Replace");
            const items = parsedDocument?.document?.content || [];

            const insertLine = (text, size, isBold) => {
                if (!text) return;
                let lines = String(text).split('\n');
                let p = targetRange.insertParagraph(lines[0].trim(), "Before");
                p.font.name = "Kalpurush"; p.font.size = size; p.font.bold = isBold;
                for (let i = 1; i < lines.length; i++) {
                    let brRange = p.insertText("\n" + lines[i].trim(), "End"); 
                    brRange.font.name = "Kalpurush"; brRange.font.size = size; brRange.font.bold = isBold;
                }
            };

            for (const item of items) {
                if (item.type === "heading") insertLine(item.text, 14, true);
                else if (item.type === "paragraph") insertLine(item.text, 11, false);
                else if (item.type === "mcq") {
                    insertLine(`${item.serial ? item.serial + ' ' : ''}${item.question}`.trim(), 11, true);
                    if (item.options && Array.isArray(item.options)) {
                        for (const opt of item.options) insertLine(`${opt.label ? opt.label + ' ' : ''}${opt.text}`.trim(), 11, false);
                    }
                    if (item.answer && item.answer.text) insertLine(item.answer.text.startsWith("উত্তর") ? item.answer.text : `উত্তর: ${item.answer.text}`, 11, true);
                    if (item.explanation && item.explanation.text) insertLine(item.explanation.text.startsWith("ব্যাখ্যা") ? item.explanation.text : `ব্যাখ্যা: ${item.explanation.text}`, 11, false);
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
