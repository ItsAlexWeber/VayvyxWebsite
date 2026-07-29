begin;

create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

alter table public.profiles
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('user', 'admin'));
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  email_address text unique not null,
  display_name text not null,
  description text null,
  imap_host text not null,
  imap_port integer not null,
  imap_secure boolean not null,
  smtp_host text not null,
  smtp_port integer not null,
  smtp_secure boolean not null,
  username text not null,
  credential_secret_id text not null,
  from_name text null,
  reply_to_address text null,
  max_attachment_mb integer not null default 25,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_accounts_email_lower_check check (email_address = lower(email_address)),
  constraint mail_accounts_imap_port_check check (imap_port between 1 and 65535),
  constraint mail_accounts_smtp_port_check check (smtp_port between 1 and 65535),
  constraint mail_accounts_max_attachment_check check (max_attachment_mb between 1 and 100),
  constraint mail_accounts_reply_to_check check (
    reply_to_address is null or reply_to_address = lower(reply_to_address)
  )
);

create table if not exists public.mail_account_members (
  id uuid primary key default gen_random_uuid(),
  mail_account_id uuid not null references public.mail_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_role text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mail_account_id, user_id),
  constraint mail_account_members_access_role_check
    check (access_role in ('viewer', 'sender', 'manager', 'owner'))
);

create or replace function public.has_mail_account_role(
  p_mail_account_id uuid,
  p_required_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.mail_account_members mam
      where mam.mail_account_id = p_mail_account_id
        and mam.user_id = auth.uid()
        and case mam.access_role
          when 'viewer' then 1
          when 'sender' then 2
          when 'manager' then 3
          when 'owner' then 4
          else 0
        end >= case p_required_role
          when 'viewer' then 1
          when 'sender' then 2
          when 'manager' then 3
          when 'owner' then 4
          else 999
        end
    );
$$;

create table if not exists public.mail_identities (
  id uuid primary key default gen_random_uuid(),
  mail_account_id uuid not null references public.mail_accounts(id) on delete cascade,
  email_address text not null,
  display_name text null,
  reply_to_address text null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_identities_email_lower_check check (email_address = lower(email_address)),
  constraint mail_identities_reply_to_lower_check check (
    reply_to_address is null or reply_to_address = lower(reply_to_address)
  )
);

create unique index if not exists mail_identities_one_default_per_account
  on public.mail_identities(mail_account_id)
  where is_default;

create table if not exists public.mail_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  mail_account_id uuid references public.mail_accounts(id) on delete set null,
  action text not null,
  target_type text not null,
  target_identifier text null,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet null,
  created_at timestamptz not null default now(),
  constraint mail_audit_log_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint mail_audit_log_action_check check (
    action in (
      'mailbox_created',
      'mailbox_updated',
      'mailbox_activated',
      'mailbox_deactivated',
      'credentials_rotated',
      'member_added',
      'member_removed',
      'member_role_changed',
      'imap_connection_tested',
      'smtp_connection_tested',
      'message_sent',
      'message_moved',
      'message_trashed',
      'attachment_downloaded'
    )
  )
);

create index if not exists mail_account_members_user_idx
  on public.mail_account_members(user_id);

create index if not exists mail_account_members_account_idx
  on public.mail_account_members(mail_account_id);

create index if not exists mail_audit_log_account_created_idx
  on public.mail_audit_log(mail_account_id, created_at desc);

create index if not exists mail_identities_account_idx
  on public.mail_identities(mail_account_id);

drop trigger if exists set_mail_accounts_updated_at on public.mail_accounts;
create trigger set_mail_accounts_updated_at
before update on public.mail_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_mail_account_members_updated_at on public.mail_account_members;
create trigger set_mail_account_members_updated_at
before update on public.mail_account_members
for each row execute function public.set_updated_at();

drop trigger if exists set_mail_identities_updated_at on public.mail_identities;
create trigger set_mail_identities_updated_at
before update on public.mail_identities
for each row execute function public.set_updated_at();

alter table public.mail_accounts enable row level security;
alter table public.mail_account_members enable row level security;
alter table public.mail_identities enable row level security;
alter table public.mail_audit_log enable row level security;

drop policy if exists "mail_accounts_select_assigned" on public.mail_accounts;
create policy "mail_accounts_select_assigned"
on public.mail_accounts
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.mail_account_members mam
    where mam.mail_account_id = mail_accounts.id
      and mam.user_id = auth.uid()
  )
);

drop policy if exists "mail_account_members_select_own_or_admin" on public.mail_account_members;
create policy "mail_account_members_select_own_or_admin"
on public.mail_account_members
for select
to authenticated
using (
  public.is_platform_admin()
  or user_id = auth.uid()
  or public.has_mail_account_role(mail_account_id, 'owner')
);

drop policy if exists "mail_identities_select_permitted" on public.mail_identities;
create policy "mail_identities_select_permitted"
on public.mail_identities
for select
to authenticated
using (public.has_mail_account_role(mail_account_id, 'viewer'));

drop policy if exists "mail_audit_select_admin_or_owner" on public.mail_audit_log;
create policy "mail_audit_select_admin_or_owner"
on public.mail_audit_log
for select
to authenticated
using (
  public.is_platform_admin()
  or (
    mail_account_id is not null
    and public.has_mail_account_role(mail_account_id, 'owner')
  )
);

revoke all on public.mail_accounts from anon, authenticated;
grant select (
  id,
  email_address,
  display_name,
  description,
  imap_host,
  imap_port,
  imap_secure,
  smtp_host,
  smtp_port,
  smtp_secure,
  username,
  from_name,
  reply_to_address,
  max_attachment_mb,
  is_active,
  created_by,
  created_at,
  updated_at
) on public.mail_accounts to authenticated;

revoke all on public.mail_account_members from anon, authenticated;
grant select (
  id,
  mail_account_id,
  user_id,
  access_role,
  created_by,
  created_at,
  updated_at
) on public.mail_account_members to authenticated;

revoke all on public.mail_identities from anon, authenticated;
grant select on public.mail_identities to authenticated;

revoke all on public.mail_audit_log from anon, authenticated;
grant select (
  id,
  actor_user_id,
  mail_account_id,
  action,
  target_type,
  target_identifier,
  metadata,
  ip_address,
  created_at
) on public.mail_audit_log to authenticated;

revoke all on schema vault from anon, authenticated;
revoke all on all tables in schema vault from anon, authenticated;
revoke all on all functions in schema vault from anon, authenticated;

create or replace function public.mail_vault_create_secret(
  p_secret text,
  p_name text,
  p_description text
)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'Secret value is required';
  end if;

  select id
  into v_secret_id
  from vault.create_secret(p_secret, p_name, p_description);

  return v_secret_id::text;
end;
$$;

create or replace function public.mail_vault_update_secret(
  p_secret_id uuid,
  p_secret text,
  p_name text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'Secret value is required';
  end if;

  if not exists (
    select 1
    from public.mail_accounts
    where credential_secret_id = p_secret_id::text
  ) then
    raise exception 'Mail credential secret not found';
  end if;

  perform vault.update_secret(p_secret_id, p_secret, p_name, p_description);
end;
$$;

create or replace function public.mail_vault_read_secret(p_secret_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = p_secret_id
    and exists (
      select 1
      from public.mail_accounts
      where credential_secret_id = p_secret_id::text
    );
$$;

create or replace function public.mail_vault_delete_secret(p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if exists (
    select 1
    from public.mail_accounts
    where credential_secret_id = p_secret_id::text
  ) then
    raise exception 'Mail credential secret is still in use';
  end if;

  perform vault.delete_secret(p_secret_id);
end;
$$;

revoke all on function public.mail_vault_create_secret(text, text, text) from public;
revoke all on function public.mail_vault_update_secret(uuid, text, text, text) from public;
revoke all on function public.mail_vault_read_secret(uuid) from public;
revoke all on function public.mail_vault_delete_secret(uuid) from public;
grant execute on function public.mail_vault_create_secret(text, text, text) to service_role;
grant execute on function public.mail_vault_update_secret(uuid, text, text, text) to service_role;
grant execute on function public.mail_vault_read_secret(uuid) to service_role;
grant execute on function public.mail_vault_delete_secret(uuid) to service_role;

commit;
