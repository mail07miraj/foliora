# Foliora Studio — AppSource Reviewer Account Setup

This guide provisions a dedicated Microsoft AppSource reviewer account without adding a developer backdoor or test-mode bypass to the add-in.

## 1. Create the reviewer user in Supabase

In the Foliora Supabase project:

1. Open **Authentication → Users**.
2. Choose **Add user / Create user**.
3. Create a dedicated account that is safe to share with Microsoft certification reviewers.
4. Use a strong password that is not used anywhere else.
5. If your project requires email confirmation, confirm the user in the Supabase dashboard.

Recommended naming:

- Email: `appsource-reviewer@<your-domain>`
- Display name: `Foliora AppSource Reviewer`

Do not put the password in GitHub.

## 2. Copy the reviewer's User UID

After creating the user, copy the user's UUID from **Authentication → Users**.

## 3. Grant MCQ Studio Pro entitlement

Open **SQL Editor** in the same Supabase project and run this after replacing the email:

```sql
delete from public.entitlements e
using auth.users u
where e.user_id = u.id
  and u.email = 'appsource-reviewer@<your-domain>'
  and e.product_id = 'foliora-mcq';

insert into public.entitlements (user_id, product_id, tier, is_active)
select id, 'foliora-mcq', 'pro', true
from auth.users
where email = 'appsource-reviewer@<your-domain>';
```

## 4. Grant OCR trial entitlement

```sql
delete from public.entitlements e
using auth.users u
where e.user_id = u.id
  and u.email = 'appsource-reviewer@<your-domain>'
  and e.product_id = 'foliora-ocr';

insert into public.entitlements (user_id, product_id, tier, is_active)
select id, 'foliora-ocr', 'free', true
from auth.users
where email = 'appsource-reviewer@<your-domain>';
```

## 5. Give the reviewer a clean OCR quota

If the `usage_quotas` table exists with the fields used by the application, initialise the current billing month:

```sql
delete from public.usage_quotas q
using auth.users u
where q.user_id = u.id
  and u.email = 'appsource-reviewer@<your-domain>'
  and q.product_id = 'foliora-ocr'
  and q.billing_cycle_month = to_char(current_date, 'YYYY-MM');

insert into public.usage_quotas
  (user_id, product_id, billing_cycle_month, used_units, unit_limit)
select
  id,
  'foliora-ocr',
  to_char(current_date, 'YYYY-MM'),
  0,
  10
from auth.users
where email = 'appsource-reviewer@<your-domain>';
```

If Supabase reports a column/type mismatch, do not change the production schema based on this guide; use the existing table definition.

## 6. Verify in Foliora

In Word:

1. Open Foliora Studio.
2. Sign in with the reviewer account.
3. Open **My Foliora**.
4. Press **Sync**.
5. Confirm:
   - MCQ Studio → **Pro Active**
   - OCR Studio → **10 pgs/mo (Trial)**
   - Converter → **Free Lifetime**
6. Return to MCQ Studio.
7. The locked card should disappear and the MCQ tools should become visible.

## 7. Do not add a test bypass

Do not add a hard-coded email, URL parameter, localStorage flag, or JavaScript-only review mode. AppSource reviewers should exercise the same entitlement path as a real account.

## 8. AppSource submission values

After verification, record:

- Reviewer email
- Reviewer password
- MCQ Studio: Pro
- OCR: Free 10 pages/month
- Any sample files needed for testing

Keep credentials out of GitHub, source code, screenshots, and public documentation.
