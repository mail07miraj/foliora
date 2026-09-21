# Foliora Studio — AppSource Certification Test Plan

## Test account
Create a dedicated reviewer account. Do not use a personal production account.

- Email: TODO
- Password: TODO
- MCQ Studio entitlement: TODO
- OCR quota: TODO

## 1. Open the add-in
1. Install/sideload the current manifest.
2. Open Word and launch **Foliora Studio** from the Home ribbon.
3. Confirm the task pane loads over HTTPS.

## 2. Free Converter
1. Select representative Bangla Unicode text.
2. Run the appropriate converter.
3. Confirm the selected content is replaced as expected.
4. Test mixed Bangla/English text and numeric content.

## 3. MCQ Studio
1. Sign in with the reviewer account.
2. Test normal MCQ formatting and Smart MCQ formatting.
3. Add questions to the question bank.
4. Run duplicate detection.
5. Generate a question set and insert it into Word.

## 4. OCR Studio
1. Open OCR Studio.
2. Upload the supplied sample image.
3. Start extraction.
4. Confirm it works without a Gemini API key.
5. Confirm quota information is displayed.
6. Insert and review the returned structured content.

## 5. Account
1. Sign out.
2. Confirm account-only tools require sign-in.
3. Sign back in and use entitlement Sync.
4. Confirm plan/quota information refreshes.

## 6. Paid plan flow
1. Use a reviewer account with the required entitlement.
2. Verify pricing UI on desktop/web.
3. Verify external checkout opens only after explicit user action.
4. Verify entitlement synchronization after returning to Word.

## Certification notes
Provide the reviewer with the test account, sample files, exact steps above, and any external checkout/test entitlement instructions required to exercise advertised paid functionality.
