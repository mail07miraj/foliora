const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 15 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch (e) { reject(new Error("Invalid JSON request.")); }
    });
    req.on("error", reject);
  });
}

async function verifyUser(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error("Server authentication is not configured.");

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  return await response.json();
}

async function consumeQuota(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_ocr_page`, {
    method: "POST",
    headers: {
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });

  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}

  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Server quota verification failed.");
  }

  return Array.isArray(data) ? data[0] : data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed." });
  }

  try {
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ")) {
      return json(res, 401, { error: "Authentication required." });
    }

    const accessToken = auth.slice(7).trim();
    const user = await verifyUser(accessToken);
    if (!user?.id) return json(res, 401, { error: "Your session is invalid or expired." });

    const body = await readBody(req);
    const mimeType = String(body.mimeType || "");
    const data = String(body.data || "");

    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mimeType)) {
      return json(res, 400, { error: "Unsupported image type." });
    }
    if (!data || data.length < 20) {
      return json(res, 400, { error: "Image data is missing." });
    }

    // Base64 expands binary data by about 4/3.
    if (Math.ceil(data.length * 0.75) > MAX_IMAGE_BYTES) {
      return json(res, 413, { error: "Image is too large. Please use an image under 10 MB." });
    }

    const quota = await consumeQuota(accessToken);
    if (!quota?.allowed) {
      return json(res, 429, {
        error: `Monthly OCR limit reached (${quota?.used ?? 0}/${quota?.limit ?? 0}). Please upgrade your plan.`,
        quota: { used: quota?.used ?? 0, limit: quota?.limit ?? 0 }
      });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("AI OCR service is not configured.");

    const prompt = `You are the document understanding and formatting engine of Foliora OCR Studio.

The original document is the source of truth. Do not rewrite, summarize, improve, correct, reorder, or reinterpret the content. Extract and reconstruct the content exactly as it appears in the source as much as possible.

Preserve original wording, Bangla text, conjunct characters, names, numbers, question numbering, option labels, punctuation, mathematical expressions, symbols, English words, headings, paragraphs, lists, tables, line/section relationships, and original content order.

Never invent missing content. Never silently correct uncertain OCR. If a character or word is uncertain, preserve the closest readable source text and mark the uncertainty.

If the document contains MCQs, identify them as MCQs. Preserve serial number, question, option text/labels, answer, and explanation. Do not shuffle options or renumber questions.

Return valid JSON only using exactly:
{
  "document": {
    "title": "",
    "content": [
      {"type":"heading","text":"","confidence":"high"},
      {"type":"paragraph","text":"","confidence":"high"},
      {"type":"mcq","serial":"","question":"","options":[{"label":"","text":""}],"answer":{"text":"","confidence":"high"},"explanation":{"text":"","confidence":"high"},"confidence":"high"}
    ]
  }
}
Use null when answer or explanation does not exist.`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    const geminiText = await geminiResponse.text();
    let geminiJson = null;
    try { geminiJson = JSON.parse(geminiText); } catch (e) {}

    if (!geminiResponse.ok) {
      const msg = geminiJson?.error?.message || "Gemini OCR request failed.";
      return json(res, 502, { error: msg, quota: { used: quota.used, limit: quota.limit } });
    }

    const output = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!output) {
      return json(res, 502, { error: "AI returned an empty response.", quota: { used: quota.used, limit: quota.limit } });
    }

    return json(res, 200, {
      text: output,
      quota: { used: quota.used, limit: quota.limit }
    });
  } catch (error) {
    return json(res, 500, { error: error.message || "OCR service error." });
  }
};
