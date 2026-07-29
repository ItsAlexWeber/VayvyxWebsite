begin;

create table if not exists public.mail_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  subject_template text null,
  html_content text not null,
  plain_text_content text null,
  scope text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  updated_by uuid null references auth.users(id) on delete set null,
  default_mail_account_id uuid null
    references public.mail_accounts(id)
    on delete set null,
  preview_metadata jsonb null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mail_templates_name_check
    check (length(btrim(name)) between 1 and 160),

  constraint mail_templates_description_check
    check (description is null or length(description) <= 1000),

  constraint mail_templates_subject_check
    check (subject_template is null or length(subject_template) <= 500),

  constraint mail_templates_html_content_check
    check (length(html_content) between 1 and 500000),

  constraint mail_templates_plain_text_check
    check (plain_text_content is null or length(plain_text_content) <= 500000),

  constraint mail_templates_scope_check
    check (scope in ('personal', 'company', 'system')),

  constraint mail_templates_preview_metadata_check
    check (preview_metadata is null or jsonb_typeof(preview_metadata) = 'object')
);

create table if not exists public.mail_template_assets (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null
    references public.mail_templates(id)
    on delete cascade,
  filename text not null,
  content_type text not null,
  byte_size integer not null,
  cid text not null,
  content_base64 text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  unique (template_id, cid),

  constraint mail_template_assets_filename_check
    check (length(btrim(filename)) between 1 and 180),

  constraint mail_template_assets_content_type_check
    check (content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),

  constraint mail_template_assets_byte_size_check
    check (byte_size between 1 and 2097152),

  constraint mail_template_assets_cid_check
    check (cid ~ '^[a-zA-Z0-9._-]+@vayvyx-template$'),

  constraint mail_template_assets_content_check
    check (length(content_base64) > 0)
);

create index if not exists mail_templates_scope_active_idx
  on public.mail_templates(scope, is_active, updated_at desc);

create index if not exists mail_templates_created_by_idx
  on public.mail_templates(created_by, updated_at desc);

create index if not exists mail_templates_default_account_idx
  on public.mail_templates(default_mail_account_id, updated_at desc);

create index if not exists mail_template_assets_template_idx
  on public.mail_template_assets(template_id);

drop trigger if exists set_mail_templates_updated_at
  on public.mail_templates;

create trigger set_mail_templates_updated_at
before update on public.mail_templates
for each row
execute function public.set_updated_at();

create or replace function public.can_read_mail_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mail_templates mt
    where mt.id = p_template_id
      and mt.is_active = true
      and (
        mt.scope = 'system'
        or mt.created_by = auth.uid()
        or public.is_platform_admin()
        or (
          mt.scope = 'company'
          and mt.default_mail_account_id is not null
          and public.has_mail_account_role(mt.default_mail_account_id, 'viewer')
        )
      )
  );
$$;

create or replace function public.can_edit_mail_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mail_templates mt
    where mt.id = p_template_id
      and mt.is_active = true
      and mt.scope <> 'system'
      and (
        mt.created_by = auth.uid()
        or public.is_platform_admin()
        or (
          mt.scope = 'company'
          and mt.default_mail_account_id is not null
          and public.has_mail_account_role(mt.default_mail_account_id, 'manager')
        )
      )
  );
$$;

alter table public.mail_templates
  enable row level security;

alter table public.mail_template_assets
  enable row level security;

drop policy if exists "mail_templates_select_permitted"
  on public.mail_templates;

create policy "mail_templates_select_permitted"
on public.mail_templates
for select
to authenticated
using (public.can_read_mail_template(id));

drop policy if exists "mail_template_assets_select_permitted"
  on public.mail_template_assets;

create policy "mail_template_assets_select_permitted"
on public.mail_template_assets
for select
to authenticated
using (public.can_read_mail_template(template_id));

revoke all on public.mail_templates
  from anon, authenticated;

grant select (
  id,
  name,
  description,
  subject_template,
  html_content,
  plain_text_content,
  scope,
  created_by,
  updated_by,
  default_mail_account_id,
  preview_metadata,
  is_active,
  created_at,
  updated_at
) on public.mail_templates
to authenticated;

revoke all on public.mail_template_assets
  from anon, authenticated;

grant select (
  id,
  template_id,
  filename,
  content_type,
  byte_size,
  cid,
  created_by,
  created_at
) on public.mail_template_assets
to authenticated;

alter table public.mail_audit_log
  drop constraint if exists mail_audit_log_action_check;

alter table public.mail_audit_log
  add constraint mail_audit_log_action_check
  check (
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
      'attachment_downloaded',
      'template_created',
      'template_updated',
      'template_duplicated',
      'template_imported',
      'template_exported',
      'template_deleted',
      'template_used',
      'template_test_sent'
    )
  );

commit;
