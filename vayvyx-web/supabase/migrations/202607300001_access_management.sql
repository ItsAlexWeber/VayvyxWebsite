begin;

alter table public.profiles
  add column if not exists email text null,
  add column if not exists full_name text null,
  add column if not exists access_type text not null default 'beta',
  add column if not exists account_status text not null default 'active',
  add column if not exists setup_completed_at timestamptz null,
  add column if not exists access_expires_at timestamptz null,
  add column if not exists invited_by uuid references auth.users(id),
  add column if not exists disabled_at timestamptz null,
  add column if not exists disabled_by uuid references auth.users(id),
  add column if not exists admin_notes text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.profiles
set setup_completed_at = coalesce(setup_completed_at, now())
where account_status = 'active'
  and setup_completed_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_access_type_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_access_type_check
      check (access_type in ('beta', 'licensed', 'mail_only', 'none'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_account_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_account_status_check
      check (account_status in ('invited', 'setup_incomplete', 'active', 'disabled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_email_lower_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_email_lower_check
      check (email is null or email = lower(email));
  end if;
end $$;

create unique index if not exists profiles_email_unique_idx
  on public.profiles(email)
  where email is not null;

drop trigger if exists set_profiles_updated_at
  on public.profiles;

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create table if not exists public.access_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  target_user_id uuid references auth.users(id),
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet null,
  created_at timestamptz not null default now(),

  constraint access_audit_log_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),

  constraint access_audit_log_action_check
    check (
      action in (
        'person_invited',
        'invitation_resent',
        'invite_completed',
        'profile_repaired',
        'profile_updated',
        'password_reset_sent',
        'access_disabled',
        'access_reactivated',
        'mailbox_access_added',
        'mailbox_access_updated',
        'mailbox_access_removed'
      )
    )
);

create index if not exists access_audit_target_created_idx
  on public.access_audit_log(target_user_id, created_at desc);

create index if not exists access_audit_actor_created_idx
  on public.access_audit_log(actor_user_id, created_at desc);

alter table public.access_audit_log
  enable row level security;

drop policy if exists "access_audit_select_platform_admin"
  on public.access_audit_log;

create policy "access_audit_select_platform_admin"
on public.access_audit_log
for select
to authenticated
using (public.is_platform_admin());

revoke all on public.access_audit_log
  from anon, authenticated;

grant select (
  id,
  actor_user_id,
  target_user_id,
  action,
  metadata,
  ip_address,
  created_at
) on public.access_audit_log
to authenticated;

commit;
