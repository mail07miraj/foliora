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
  ["OCR uses supported Gemini 3.5 Flash-Lite model", ocr.includes("gemini-3.5-flash-lite:generateContent")],
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
  ["paid actions are marked for mobile policy", index.includes("data-paid-action")],
  ["normal MCQ answer is inserted on final option", app.includes("if (j === count - 1) mcqInsertNormalAnswer") && app.includes("if (j + 2 >= count)")],
  ["standard-text answer format is preserved in set generator", app.includes("mcqBuildPreservedAnswerText(question, normalizedAnswer) || getStandardAnswerMarker(normalizedAnswer, isUnicode)")],
  ["embedded Bijoy answer markers are checked only on final option", app.includes("const lastIndex = q.options.length - 1")],
  ["MCQ answer resolver is present", app.includes("function mcqResolveAnswer(question)")],
  ["MCQ detects unnumbered question before options", app.includes("return mcqIsOptionLine(next);")],
  ["MCQ detects colon/dash question forms through option lookahead", app.includes("function mcqLooksLikeQuestionStart(line, nextLine)")],
  ["MCQ preserves source font", app.includes("source?.font?.name") && app.includes("const questionFont = sourceStyle.fontName ||")],
  ["MCQ options are explicitly non-bold", app.includes("questionFont, questionSize, questionAlign,\n                        false, false")],
  ["Number & Bold excludes option lines", app.includes("mcqIsOptionLine(current) || mcqIsAnswerLine(current) || mcqIsExplanationLine(current)")],
  ["Number & Bold supports unnumbered question before options", app.includes("if (mcqLooksLikeQuestionStart(current, next))")],
  ["MCQ extracts actual source run font", app.includes("function mcqExtractFontFromOoxml(ooxml, fallbackFont = "")")],
  ["MCQ preserves per-option source font", app.includes("option._sourceStyle =")],
  ["MCQ preserves source font slots when supported", app.includes("range.font.nameAscii = style.ascii")],
  ["MCQ answer uses final option source font", app.includes("question?.answerStyle || question?.options?.[question.options.length - 1]?._sourceStyle")],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? "PASS " : "FAIL ") + name);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log("All Foliora Phase B smoke checks passed.");
