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
        'জ্ঞ':'Á', 'ঙ্ক':'¼', 'ঙ্খ':'¼L', 'ঙ্গ':'½', 'ঙ্ঘ':'½N', 'ট্ট':'Æ', 'ঠ্ঠ':'V&V', 'ড্ড':'Ç', 'ণ্ট':'È', 'ণ্ঠ':'É', 'ণ্ড':'Û', 'ন্ড':'Û',
        'ত্ত':'Ë', 'ত্থ':'Ì', 'ত্র':'Î', 'দ্দ':'Ï', 'দ্ধ':'×', 'দ্ব':'Ø', 'দ্ম':'Ù', 'ন্দ':'›`', 'ন্দ্র':'›`ª', 'ন্ধ':'Ü', 'ধ্রু':'aªæ', 'ন্ন':'bœ', 'ন্ব':'b¦', 'ন্ম':'b¥', 'ন্দ্র':'›`«', 'দ্র':'`ª',
        'ম্প':'¤ú', 'ম্ব':'¤^', 'ম্ম':'¤§', 'ম্ভ':'¤¢', 'ন্স':'Ý', 'ত্ম':'Z¥', 'ত্ন':'Zœ', 'ত্ম্য':'Z¥¨', 'স্ট':'÷', 'ষ্ট':'ó', 'ষ্ঠ':'ô', 'ষ্ণ':'ò', 'ষ্প':'®ú', 'ষ্ফ':'®ù', 'ষ্ম':'®§',
        'স্ক':'¯‹', 'স্খ':'¯Œ', 'স্থ':'¯’', 'স্ন':'mœ', 'স্প':'¯ú', 'স্ফ':'ù', 'স্ম':'¯§', 'স্ব':'¯^', 'স্ত':'¯Í', 'স্স':'m&m',
        'হ্ম':'þ', 'হু':'û', 'হৃ':'ü', 'হ্ন':'ý', 'হ্ব':'nŸ', 'প্ত':'ß', 'ব্দ':'ã', 'ব্ধ':'ä', 'ব্ব':'e&e', 'ব্জ':'e&R',
        'শ্র':'kÖ', 'ক্র':'µ', 'গ্র':'MÖ', 'প্র':'cÖ', 'ড্র':'W«', 'ট্র':'U«', 'ফ্র':'d«', 'ব্র':'eª',
        'ব্ল':'eø', 'ক্ল':'K¬', 'গ্ল':'Mø', 'প্ল':'cø', 'ফ্ল':'d¬', 'ম্ল':'gø', 'ম্ফ':'ç', 'শ্ল':'kø', 'স্ল':'mø', 'হ্ল':'n&j',
        'ঞ্চ':'Â', 'ঞ্ছ':'Ã', 'ঞ্জ':'Ä', 'রু':'iæ', 'রূ':'i~', 'শু':'ï', 'গু':'¸', 'ন্তু':'š‘', 'স্তু':'¯‘',
        'চ্চ':'”P', 'চ্ছ':'”Q', 'জ্জ':'¾', 'ঝ্ঝ':'S&S', 'দ্ঘ':'`&N', 'ন্ত':'šÍ', 'ন্থ':'š’', 'ল্প':'í', 'ল্ব':'j&e', 'ল্ম':'j&g', 'ল্ল':'jø', 'ল্ফ':'j&d', 'ল্ট':'ë',
        'ধ্ব':'aŸ', 'শ্ব':'k¦', 'ত্ব':'Z¡', 'থ্ব':'_¡', 'ম্ন':'gœ', 'শ্ম':'k&g', 'দ্য':'`¨', 'ন্ত্র':'š¿', 'ম্প্র':'¤cÖ', 'স্থ্য':'¯’¨', 'ষ্ট্র':'ó«', 
        'শ্ন':'kœ', 'ব্য':'e¨', 'স্ত্র':'¯¿', 'ত্ত্ব':'Ë¡', 'ন্দ্ব':'›Ø', 'প্ন':'cœ', 'ত্য':'Z¨', 'স্ক্র':'¯‹«', 'স্ট্র':'÷«', 'থ্র':'_«', 'প্প':'c&c', 'প্স':'c&m',
        'ঙ্ক্ষ':'¼¶', 'ঙ্ম':'O&g', 'গ্ধ':'\xBB', '্য':'¨', '্র':'«', '্':'&',
        'কু':'Kz', 'কূ':'K‚', 'চু':'Pz', 'চূ':'P‚', 'ঝু':'Sz', 'ঝূ':'S‚', 'তু':'Zz', 'তূ':'Z‚', 'ভূ':'f‚', 'কৃ':'K…', 'তৃ':'Z…',
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
    let str = text.replace(/[\u200B-\u200D\uFEFF\+]/g, "");

    const b2uJukta = {
        '›U':'ন্ট', 'Þ':'প্ট', '®‹':'ষ্ক', 'é':'ল্ক', 'ê':'ল্গ', 'ì':'ল্ড', 'ë':'ল্ট', 'ð':'শ্চ', '¯‹…':'স্কৃ',
        'M¦':'গ্ব', 'fz':'ভু', 'L¡':'খ্ব', '°':'ক্ক', '±':'ক্ট', '³':'ক্ত', 'K¡':'ক্ব',
        '·':'ক্স', '¯‹':'স্কু', '¶':'ক্ষ', '²':'ক্ষ্ম', '¶¨':'ক্ষ্য', '¶z':'ক্ষু',
        'Á':'জ্ঞ', '¼':'ঙ্ক', '¼L':'ঙ্খ', '½':'ঙ্গ', '½N':'ঙ্ঘ', 'Æ':'ট্ট', 'Ç':'ড্ড',
        'È':'ণ্ট', 'É':'ণ্ঠ', 'Û':'ণ্ড', '\xDB':'ণ্ড',
        'Ë':'ত্ত', 'Ì':'ত্থ', 'Î':'ত্র', 'Ï':'দ্দ', '×':'দ্ধ', 'Ø':'দ্ব', 'Ù':'দ্ম', '›`ª':'ন্দ্র',
        '›`':'ন্দ', 'Ü':'ন্ধ', 'aªæ':'ধ্রু', 'bœ':'ন্ন', 'b¦':'ন্ব', 'b¥':'ন্ম', '›`«':'ন্দ্র', '`ª':'দ্র',
        '¤ú':'ম্প', 'ç':'ম্ফ', '¤^':'ম্ব', '¤§':'ম্ম', '¤¢':'ম্ভ', 'Ý':'ন্স', 'Z¥':'ত্ম', 'Zœ':'ত্ন',
        'Z¥¨':'ত্ম্য', '÷':'স্ট', 'ó':'ষ্ট', 'ô':'ষ্ঠ', 'ò':'ষ্ণ', '®ú':'ষ্প', '®ù':'ষ্ফ',
        '®§':'ষ্ম', '¯‹':'স্ক', '¯Œ':'স্খ', '¯’':'স্থ', '¯œ':'স্ন', 'Mœ':'গ্ন', '¯ú':'স্প', 'ù':'স্ফ',
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
