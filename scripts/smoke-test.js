const fs = require("fs");

const app = fs.readFileSync("app.js", "utf8");
const ocr = fs.readFileSync("api/ocr.js", "utf8");
const manifest = fs.readFileSync("manifest.xml", "utf8");
const index = fs.readFileSync("index.html", "utf8");

const checks = [
  ["client Gemini key storage removed", !app.includes("gemini_api_key") && !index.includes("gemini-api-key")],
  ["client direct Gemini endpoint removed", !app.includes("generativelanguage.googleapis.com")],
  ["secure OCR endpoint wired", app.includes('fetch("/api/ocr"')],
  ["server Gemini endpoint present", ocr.includes("generativelanguage.googleapis.com")],
  ["server Gemini secret is environment-only", ocr.includes("process.env.GEMINI_API_KEY")],
  ["OCR endpoint authenticates bearer token", ocr.includes("Authorization") && ocr.includes("Bearer ")],
  ["OCR endpoint enforces image size", ocr.includes("MAX_IMAGE_BYTES")],
  ["manifest has Foliora publisher", manifest.includes("<ProviderName>Foliora</ProviderName>")],
  ["manifest has unique non-placeholder id", !manifest.includes("12345678-abcd-ef01-2345-6789abcdef01")],
  ["manifest has command icon 16", manifest.includes('id="icon16"')],
  ["manifest has command icon 32", manifest.includes('id="icon32"')],
  ["manifest has command icon 80", manifest.includes('id="icon80"')],
  ["manifest command references icon80", manifest.includes('size="80" resid="icon80"')],
  ["manifest has support URL", manifest.includes("<SupportUrl")],
  ["manifest uses HTTPS source", manifest.includes("https://foliora-gamma.vercel.app/index.html")],
  ["mobile commerce guard present", app.includes("isMobileCommerceRestricted") && app.includes("applyMobileCommerceRestrictions")],
  ["paid actions are marked for mobile policy", index.includes("data-paid-action")]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? "PASS " : "FAIL ") + name);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log("All Foliora Phase B smoke checks passed.");
