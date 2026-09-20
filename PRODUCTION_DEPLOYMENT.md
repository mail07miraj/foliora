# Foliora Studio — Production Deployment

## Required Vercel environment variables

Add these variables to the Vercel project that serves `https://foliora-gamma.vercel.app`:

- `GEMINI_API_KEY` — the server-side Google Gemini API key used only by `/api/ocr`.
- `SUPABASE_URL` — the same Supabase project URL used by the add-in.
- `SUPABASE_ANON_KEY` — the Supabase anon/public key for authenticated RPC calls.

Do **not** put `GEMINI_API_KEY` in `index.html`, `app.js`, browser localStorage, or the Office manifest.

## OCR request flow

Word add-in -> authenticated Supabase session -> `/api/ocr` -> server-side quota RPC -> Gemini -> JSON response -> Word document.

The browser never receives the Gemini API key.

## Deployment

After setting the Vercel environment variables, redeploy the production deployment. The Office add-in will call the same-origin `/api/ocr` endpoint.

## Supabase

The existing `consume_ocr_page` RPC remains the authoritative monthly OCR quota check. The server endpoint calls it with the authenticated user's access token.

## Public legal pages

- `/privacy.html`
- `/terms.html`
- `/eula.html`
- `/support.html`
