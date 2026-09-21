# Foliora Studio — Phase B-4 AppSource Submission Pack

Updated: September 22, 2026

## Offer identity
- Product name: **Foliora Studio**
- Publisher: **Foliora**
- Host: **Microsoft Word**
- Manifest type: **Office Add-in only (XML)**
- Manifest ID: `9b2d7f4e-2a1c-4c6e-9d7a-b5f3a8c9e420`
- Current version: **1.2.1**
- Production app: `https://foliora-gamma.vercel.app/index.html`

## Required public URLs
- Support: `https://foliora-gamma.vercel.app/support.html`
- Privacy: `https://foliora-gamma.vercel.app/privacy.html`
- EULA: `https://foliora-gamma.vercel.app/eula.html`
- Terms: `https://foliora-gamma.vercel.app/terms.html`

These URLs must be live, HTTPS, and return valid pages before submission.

## Store copy

### Search results summary
Bangla publication and document tools for formatting, conversion, MCQ workflows, and OCR in Word.

### Short description
A focused workspace for Bangla publication workflows, including MCQ formatting, question-bank tools, Bangla conversion, English font cleanup, and AI-assisted OCR.

### Long description
<p><strong>Build and prepare Bangla documents faster.</strong> Foliora Studio brings practical publication and document-production tools into one Word workspace for educators, publishers, content teams, and other users who work with Bangla documents.</p>
<p><strong>Core tools include:</strong></p>
<ul>
<li><strong>MCQ Studio:</strong> format questions, manage a question bank, find duplicates, and generate question sets.</li>
<li><strong>Bangla Converter:</strong> convert between Bijoy and Unicode workflows and preserve mixed Bangla/English content.</li>
<li><strong>English Font Fixer:</strong> clean and standardize English text formatting inside selected Word content.</li>
<li><strong>OCR Studio:</strong> extract structured text from selected images using Foliora's server-side AI OCR service.</li>
<li><strong>Workspace:</strong> keep frequently used tools together in a focused task-pane workflow.</li>
</ul>
<p>Some account-based features require a Foliora account. Certain advanced features may require a paid Foliora plan. Pricing and entitlement information are shown in the add-in. OCR requests are processed through Foliora's server infrastructure and Google Gemini; users do not need to provide a Gemini API key.</p>
<p>Review generated or extracted content before publication, especially OCR output, because automated extraction can contain errors.</p>

### Suggested search keywords
- Bangla OCR
- MCQ formatter
- Bijoy Unicode

## Listing media
- Required screenshot: at least 1 PNG.
- Prepare screenshots in a Partner Center-supported PNG size/aspect ratio with readable UI and no personal information. The current five screenshots were captured from the working Word add-in and should be normalized to the exact dimensions accepted by the Partner Center submission form rather than assuming a universal 1366 × 768 requirement.
- Recommended set: MCQ Studio, Bangla Converter, OCR Studio, Question Bank/Generator, account/workspace.
- Manifest task-pane icon: 32 × 32 PNG.
- Manifest high-resolution icon: 64 × 64 PNG.
- VersionOverrides command icons: 16 × 16, 32 × 32, and 80 × 80 PNG.
- Marketplace logo: prepare a square PNG in Microsoft's accepted marketplace logo range using the same Foliora visual identity.

## Certification test notes — required before submission
Create a dedicated reviewer account and provide it in Partner Center certification notes.

- [ ] Reviewer test account
- [ ] MCQ Studio entitlement
- [ ] OCR quota
- [ ] Sample MCQ text/document
- [ ] Sample OCR image
- [ ] Instructions for Converter
- [ ] Instructions for MCQ formatting and set generation
- [ ] Instructions for OCR
- [ ] Instructions for duplicate finder/question bank
- [ ] Instructions for sign-out/sign-in and entitlement refresh

Do not put production passwords or API keys in this repository.

## Additional services / purchase disclosure
The add-in uses Supabase for authentication and entitlement/quota state, Google Gemini for AI OCR, and an external Foliora checkout flow for paid plan upgrades. Partner Center certification notes should explain the account flow and provide any test entitlement required to exercise paid functionality.

## Current validation
- Manifest production validation: passed in GitHub Actions.
- Node syntax and smoke tests: passed in GitHub Actions.
- Production deployment: shown as Ready in Vercel.
- Live URL/browser verification from this environment: still unverified.

## Remaining blockers
1. **Replace the current paid checkout URL.** The add-in currently opens `https://foliora.com/checkout`, but no production Foliora payment provider/checkout destination has been established for this project. Do not submit until a real production checkout is configured.
2. Verify payment completion/webhook -> Supabase entitlement synchronization -> add-in refresh end-to-end.
3. Open the four legal URLs and production index in a normal browser and confirm no 404/certificate/deployment mismatch.
4. Confirm Partner Center publisher identity matches **Foliora**.
5. Create a dedicated reviewer account with working MCQ/OCR entitlements.
6. Test Word on Windows, Word on the web, and Word on Mac before submission.

See `APP_SOURCE_AUDIT.md` for the Phase B-5 audit and submission gate.

## Microsoft references
- https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests
- https://learn.microsoft.com/en-us/office/dev/add-ins/testing/troubleshoot-manifest
- https://learn.microsoft.com/en-us/partner-center/marketplace-offers/checklist
- https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-effective-office-store-listings
- https://learn.microsoft.com/en-us/legal/marketplace/certification-policies
