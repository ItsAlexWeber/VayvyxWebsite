begin;

alter table public.profiles
  add column if not exists must_set_password boolean not null default false,
  add column if not exists invitation_sent_at timestamptz null,
  add column if not exists setup_reminder_sent_at timestamptz null,
  add column if not exists password_reset_requested_at timestamptz null,
  add column if not exists last_auth_email_status text null;

alter table public.profiles
  drop constraint if exists profiles_last_auth_email_status_check;

alter table public.profiles
  add constraint profiles_last_auth_email_status_check
  check (
    last_auth_email_status is null
    or last_auth_email_status in ('sent', 'failed', 'cooldown')
  );

update public.profiles
set must_set_password = true
where setup_completed_at is null
  and account_status in ('invited', 'setup_incomplete');

update public.profiles
set must_set_password = false
where setup_completed_at is not null
  and account_status = 'active';

alter table public.mail_templates
  alter column created_by drop not null,
  add column if not exists system_key text null,
  add column if not exists is_delete_protected boolean not null default false,
  add column if not exists default_subject_template text null,
  add column if not exists default_html_content text null,
  add column if not exists default_plain_text_content text null;

alter table public.mail_templates
  drop constraint if exists mail_templates_system_key_check;

alter table public.mail_templates
  add constraint mail_templates_system_key_check
  check (
    system_key is null
    or (
      scope = 'system'
      and system_key in (
        'auth_welcome_invite',
        'auth_password_reset',
        'auth_setup_reminder',
        'auth_password_changed',
        'auth_confirm_signup'
      )
    )
  );

alter table public.mail_templates
  drop constraint if exists mail_templates_default_subject_check;

alter table public.mail_templates
  add constraint mail_templates_default_subject_check
  check (default_subject_template is null or length(default_subject_template) <= 500);

alter table public.mail_templates
  drop constraint if exists mail_templates_default_html_check;

alter table public.mail_templates
  add constraint mail_templates_default_html_check
  check (default_html_content is null or length(default_html_content) between 1 and 500000);

alter table public.mail_templates
  drop constraint if exists mail_templates_default_plain_text_check;

alter table public.mail_templates
  add constraint mail_templates_default_plain_text_check
  check (default_plain_text_content is null or length(default_plain_text_content) <= 500000);

create unique index if not exists mail_templates_system_key_unique_idx
  on public.mail_templates(system_key)
  where system_key is not null;

create table if not exists public.auth_email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  email_type text not null,
  target_user_id uuid null references auth.users(id) on delete set null,
  target_email_hash text not null,
  sender_mail_account_id uuid null references public.mail_accounts(id) on delete set null,
  status text not null,
  provider_message_id text null,
  sent_at timestamptz null,
  failure_category text null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),

  constraint auth_email_delivery_log_type_check
    check (
      email_type in (
        'auth_welcome_invite',
        'auth_password_reset',
        'auth_setup_reminder',
        'auth_password_changed',
        'auth_confirm_signup'
      )
    ),

  constraint auth_email_delivery_log_status_check
    check (status in ('sent', 'failed')),

  constraint auth_email_delivery_log_hash_check
    check (target_email_hash ~ '^[a-f0-9]{64}$'),

  constraint auth_email_delivery_log_message_id_check
    check (provider_message_id is null or length(provider_message_id) <= 500),

  constraint auth_email_delivery_log_failure_check
    check (
      failure_category is null
      or failure_category in (
        'cooldown',
        'template_unavailable',
        'action_link_failed',
        'sender_unavailable',
        'smtp_failed',
        'user_not_found',
        'invalid_action_url',
        'unknown'
      )
    )
);

create index if not exists auth_email_delivery_target_idx
  on public.auth_email_delivery_log(target_user_id, created_at desc);

create index if not exists auth_email_delivery_hash_type_idx
  on public.auth_email_delivery_log(target_email_hash, email_type, created_at desc);

create index if not exists auth_email_delivery_actor_idx
  on public.auth_email_delivery_log(actor_user_id, created_at desc);

alter table public.auth_email_delivery_log
  enable row level security;

drop policy if exists "auth_email_delivery_log_admin_select"
  on public.auth_email_delivery_log;

create policy "auth_email_delivery_log_admin_select"
on public.auth_email_delivery_log
for select
to authenticated
using (public.is_platform_admin());

revoke all on public.auth_email_delivery_log
  from anon, authenticated;

alter table public.access_audit_log
  drop constraint if exists access_audit_log_action_check;

alter table public.access_audit_log
  add constraint access_audit_log_action_check
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
      'mailbox_access_removed',
      'welcome_invitation_sent',
      'setup_reminder_sent',
      'password_changed_notification_sent',
      'auth_email_send_failed'
    )
  );

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
      'template_test_sent',
      'system_template_restored',
      'auth_template_test_sent'
    )
  );

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
      and (
        public.is_platform_admin()
        or (
          mt.scope <> 'system'
          and (
            mt.created_by = auth.uid()
            or (
              mt.scope = 'company'
              and mt.default_mail_account_id is not null
              and public.has_mail_account_role(mt.default_mail_account_id, 'manager')
            )
          )
        )
      )
  );
$$;

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
  updated_at,
  system_key,
  is_delete_protected,
  default_subject_template,
  default_html_content,
  default_plain_text_content
) on public.mail_templates
to authenticated;

insert into public.mail_templates (
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
  system_key,
  is_delete_protected,
  default_subject_template,
  default_html_content,
  default_plain_text_content
)
values
(
  'Welcome invitation',
  'Branded first-time Vayvyx account setup invitation.',
  'Welcome to Vayvyx, {{first_name}}',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Welcome, {{first_name}}</h1></td></tr><tr><td style="padding:28px"><p>Hello {{full_name}},</p><p>Your Vayvyx access has been prepared. Your access type is <strong>{{access_type}}</strong>.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>This secure link confirms your email address and lets you create your Vayvyx password. Vayvyx administrators will never email you a temporary password.</p><p>{{expiration_notice}}</p><p>Need help? Contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}. This invitation is private and should not be forwarded.</td></tr></table></td></tr></table></body></html>',
  'Welcome to {{company_name}}, {{first_name}}.

Your Vayvyx access has been prepared.
Access type: {{access_type}}

{{action_label}}:
{{action_url}}

This secure link confirms your email address and lets you create your Vayvyx password. Vayvyx administrators will never email you a temporary password.

{{expiration_notice}}

Need help? Contact {{support_email}}.',
  'system',
  null,
  null,
  null,
  '{"first_name":"Jordan","full_name":"Jordan Smith","email":"jordan@example.com","action_label":"Complete account setup","support_email":"support@vayvyx.com","company_name":"Vayvyx","access_type":"Private beta","expiration_notice":"For security, this link expires automatically."}'::jsonb,
  true,
  'auth_welcome_invite',
  true,
  'Welcome to Vayvyx, {{first_name}}',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Welcome, {{first_name}}</h1></td></tr><tr><td style="padding:28px"><p>Hello {{full_name}},</p><p>Your Vayvyx access has been prepared. Your access type is <strong>{{access_type}}</strong>.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>This secure link confirms your email address and lets you create your Vayvyx password. Vayvyx administrators will never email you a temporary password.</p><p>{{expiration_notice}}</p><p>Need help? Contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}. This invitation is private and should not be forwarded.</td></tr></table></td></tr></table></body></html>',
  'Welcome to {{company_name}}, {{first_name}}.

Your Vayvyx access has been prepared.
Access type: {{access_type}}

{{action_label}}:
{{action_url}}

This secure link confirms your email address and lets you create your Vayvyx password. Vayvyx administrators will never email you a temporary password.

{{expiration_notice}}

Need help? Contact {{support_email}}.'
),
(
  'Password reset',
  'Branded Vayvyx password-recovery message.',
  'Reset your Vayvyx password',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Reset your password</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>Use the secure link below to choose a new Vayvyx password.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>{{expiration_notice}}</p><p>If you did not request this reset, contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'Reset your {{company_name}} password.

{{action_label}}:
{{action_url}}

{{expiration_notice}}

If you did not request this reset, contact {{support_email}}.',
  'system',
  null,
  null,
  null,
  '{"first_name":"Jordan","full_name":"Jordan Smith","email":"jordan@example.com","action_label":"Reset your password","support_email":"support@vayvyx.com","company_name":"Vayvyx","access_type":"Private beta","expiration_notice":"For security, this link expires automatically."}'::jsonb,
  true,
  'auth_password_reset',
  true,
  'Reset your Vayvyx password',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Reset your password</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>Use the secure link below to choose a new Vayvyx password.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>{{expiration_notice}}</p><p>If you did not request this reset, contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'Reset your {{company_name}} password.

{{action_label}}:
{{action_url}}

{{expiration_notice}}

If you did not request this reset, contact {{support_email}}.'
),
(
  'Setup reminder',
  'Reminder for invited users who have not completed first-time setup.',
  'Reminder: complete your Vayvyx account setup',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Finish account setup</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>Your Vayvyx account is waiting for first-time setup.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>{{expiration_notice}}</p><p>Need help? Contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'Your {{company_name}} account is waiting for first-time setup.

{{action_label}}:
{{action_url}}

{{expiration_notice}}

Need help? Contact {{support_email}}.',
  'system',
  null,
  null,
  null,
  '{"first_name":"Jordan","full_name":"Jordan Smith","email":"jordan@example.com","action_label":"Complete account setup","support_email":"support@vayvyx.com","company_name":"Vayvyx","access_type":"Private beta","expiration_notice":"For security, this link expires automatically."}'::jsonb,
  true,
  'auth_setup_reminder',
  true,
  'Reminder: complete your Vayvyx account setup',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Finish account setup</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>Your Vayvyx account is waiting for first-time setup.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>{{expiration_notice}}</p><p>Need help? Contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'Your {{company_name}} account is waiting for first-time setup.

{{action_label}}:
{{action_url}}

{{expiration_notice}}

Need help? Contact {{support_email}}.'
),
(
  'Password changed',
  'Notification sent after a Vayvyx password is changed.',
  'Your Vayvyx password was changed',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Password changed</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>The password for {{email}} was changed at {{expiration_notice}}.</p><p>If you made this change, no action is needed.</p><p>If you did not make this change, contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'The password for {{email}} was changed at {{expiration_notice}}.

If you made this change, no action is needed.

If you did not make this change, contact {{support_email}}.',
  'system',
  null,
  null,
  null,
  '{"first_name":"Jordan","full_name":"Jordan Smith","email":"jordan@example.com","action_label":"","support_email":"support@vayvyx.com","company_name":"Vayvyx","access_type":"Private beta","expiration_notice":"Jul 30, 2026, 11:30 AM"}'::jsonb,
  true,
  'auth_password_changed',
  true,
  'Your Vayvyx password was changed',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Password changed</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>The password for {{email}} was changed at {{expiration_notice}}.</p><p>If you made this change, no action is needed.</p><p>If you did not make this change, contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'The password for {{email}} was changed at {{expiration_notice}}.

If you made this change, no action is needed.

If you did not make this change, contact {{support_email}}.'
),
(
  'Future signup confirmation',
  'Reserved template for future public signup confirmation.',
  'Confirm your Vayvyx email',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Confirm your email</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>Confirm your email address for {{company_name}}.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>{{expiration_notice}}</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'Confirm your email address for {{company_name}}.

{{action_label}}:
{{action_url}}

{{expiration_notice}}',
  'system',
  null,
  null,
  null,
  '{"first_name":"Jordan","full_name":"Jordan Smith","email":"jordan@example.com","action_label":"Confirm email","support_email":"support@vayvyx.com","company_name":"Vayvyx","access_type":"Private beta","expiration_notice":"For security, this link expires automatically."}'::jsonb,
  true,
  'auth_confirm_signup',
  true,
  'Confirm your Vayvyx email',
  '<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,sans-serif;color:#102133"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px"><tr><td align="center"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7e2ea"><tr><td style="background:#102133;color:#ffffff;padding:28px"><p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vayvyx</p><h1 style="margin:0;font-size:28px;line-height:1.2">Confirm your email</h1></td></tr><tr><td style="padding:28px"><p>Hello {{first_name}},</p><p>Confirm your email address for {{company_name}}.</p><p><a href="{{action_url}}" style="display:inline-block;background:#1b766e;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">{{action_label}}</a></p><p>{{expiration_notice}}</p></td></tr><tr><td style="padding:18px 28px;background:#eef4f7;color:#4b6475;font-size:13px">&copy; {{current_year}} {{company_name}}.</td></tr></table></td></tr></table></body></html>',
  'Confirm your email address for {{company_name}}.

{{action_label}}:
{{action_url}}

{{expiration_notice}}'
)
on conflict (system_key)
where system_key is not null
do update
set
  name = excluded.name,
  description = excluded.description,
  default_subject_template = excluded.default_subject_template,
  default_html_content = excluded.default_html_content,
  default_plain_text_content = excluded.default_plain_text_content,
  preview_metadata = excluded.preview_metadata,
  is_delete_protected = true,
  updated_at = now();

commit;
