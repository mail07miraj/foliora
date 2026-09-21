# Foliora Studio — Phase B-5 Final Pre-Submission Audit

Updated: September 22, 2026

## Audit result

**Status: NOT READY FOR Microsoft Marketplace submission yet.**

The Word add-in codebase is substantially prepared for submission, and the OCR production flow has been verified by the project owner after the Gemini model migration. One **critical production blocker** remains: the paid-plan checkout URL in the add-in points to `https://foliora.com/checkout`, but no production Foliora checkout service has been established at that destination.

## Passed / substantially ready

- Product identity is consistent: **Foliora Studio** / publisher **Foliora**.
- Manifest uses a unique GUID and version **1.2.1.0**.
- Manifest has task-pane icons for 32 px and 64 px high-resolution use.
- VersionOverrides contains 16 px, 32 px, and 80 px command icons.
- Manifest source, support, and app-domain URLs use HTTPS.
- Office.js is loaded from Microsoft's hosted URL.
- Requested permission is `ReadWriteDocument`.
- Secure OCR architecture is in place: Word add-in -> authenticated `/api/ocr` -> server-side quota check -> Gemini.
- Gemini API key is server-side only; it is not requested from or stored in the browser.
- OCR endpoint validates bearer authentication, image type, and a 10 MB image limit.
- OCR now uses `gemini-3.5-flash-lite`.
- Mobile purchase/up-sell UI is guarded for iOS/Android.
- Paid-action controls are explicitly marked for the mobile commerce restriction.
- Privacy, Terms, EULA, and Support pages exist in the repository.
- AppSource listing/test-plan documentation exists.
- Five final product screenshots have been prepared.
- The current OCR screenshot demonstrates successful extraction and the visible `Smart AI Extraction Completed!` state.
- GitHub validation workflow is configured to run Node syntax/smoke checks and manifest validation.

## Critical blocker

### External paid checkout is not production-ready

Current code opens:

`https://foliora.com/checkout?user_id=...&email=...&plan=...`

No production payment provider or checkout destination was previously established for Foliora. Public web search currently shows **foliora.com as a domain-for-sale page**, so this URL must not be used as a production purchase destination.

**Do not submit the add-in with the current paid checkout URL.**

Required before submission:
1. Establish the actual Foliora payment provider / checkout service.
2. Obtain the real production HTTPS checkout URL or production checkout route.
3. Verify the plan identifier passed by the add-in.
4. Verify payment completion/webhook -> entitlement update in Supabase.
5. Verify the add-in refreshes entitlement after returning to Word.
6. Test the purchase flow before certification.

## Important non-blocking finding

### OCR quota failure behavior

The server currently consumes an OCR page before calling Gemini. If Gemini fails after quota consumption, the page can remain counted. A future hardening pass should add an atomic reservation/commit or refund mechanism.

This was not changed blindly because the repository does not contain a verified refund RPC or quota migration definition.

## Reviewer account

A dedicated Microsoft certification account is still required with:
- MCQ Studio: Pro entitlement
- OCR Studio: Free/trial entitlement
- sufficient OCR quota
- working sign-in and entitlement Sync

Do not place reviewer credentials in GitHub.

## Submission gate

- [x] Core manifest structure prepared
- [x] Gemini key removed from client
- [x] OCR production flow working
- [x] Mobile purchase guard present
- [x] Legal/support pages prepared
- [x] Five product screenshots prepared
- [ ] **Production payment/checkout destination established**
- [ ] **Payment -> webhook -> entitlement flow verified**
- [ ] Dedicated reviewer account provisioned
- [ ] Final Word Windows/Web/Mac compatibility test completed
- [ ] Public production URLs rechecked immediately before Partner Center submission

## Decision

**B-5 audit complete, but submission is blocked by the paid checkout flow.**

Do not create a fake checkout page or point the add-in at a placeholder domain. The real payment provider/production checkout destination must be established first.
