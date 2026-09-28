-- Foliora Admin Console Phase 3
-- Run this once in Supabase SQL Editor before using Subscription History / Activity Log.

create extension if not exists pgcrypto;

create table if not exists public.subscription_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id varchar not null,
  action varchar not null,
  tier varchar,
  valid_from timestamptz,
  valid_until timestamptz,
  ocr_limit integer,
  changed_by uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists subscription_history_user_idx
  on public.subscription_history(user_id, created_at desc);

create table if not exists public.admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid,
  action varchar not null,
  target_user_id uuid,
  target_email varchar,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_activity_logs_created_idx
  on public.admin_activity_logs(created_at desc);

create index if not exists admin_activity_logs_target_idx
  on public.admin_activity_logs(target_user_id, created_at desc);

alter table public.subscription_history enable row level security;
alter table public.admin_activity_logs enable row level security;

-- These tables are intentionally service-role managed by /api/admin.
-- Do not add anon/authenticated write policies for the admin logs.
