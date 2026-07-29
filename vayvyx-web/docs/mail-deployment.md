# Vayvyx Mail Phase 1 Deployment

This document covers the secure foundation for Vayvyx Mail: database schema, RLS, Vault-backed mailbox credentials, backend deployment, and local verification.

## Architecture

Vayvyx Mail uses Supabase Auth for one login per person. The browser sends the user's Supabase bearer token to the Node backend. The backend validates that token with a user-scoped Supabase client, then checks `public.profiles.role` and mailbox membership before performing any mailbox operation.

The backend also owns a separate server administration Supabase client. That client uses `SUPABASE_SECRET_KEY` or the legacy `SUPABASE_SERVICE_ROLE_KEY` from `/etc/vayvyx-mail.env`. Browser bearer tokens are never used to configure the admin client.

Mailbox passwords are stored in Supabase Vault. `public.mail_accounts.credential_secret_id` stores only the Vault secret identifier. The migration revokes browser access to that column and locks Vault wrapper functions to the `service_role` role.

## Supabase Setup

1. Apply `supabase/migrations/202607280001_mail_foundation.sql`.
2. Confirm the `supabase_vault` extension is enabled in the `vault` schema.
3. Confirm `public.profiles.role` exists and allows only `user` or `admin`.
4. Manually promote Alexander's profile:

```sql
update public.profiles
set role = 'admin'
where id = '<alexander-auth-user-id>';
```

5. Confirm authenticated users do not have direct access to `credential_secret_id`:

```sql
select grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'mail_accounts'
  and column_name = 'credential_secret_id';
```

Only service/admin roles should have access.

## Supabase Data API Readiness

The following objects must be available to the backend through Supabase APIs while RLS and grants remain restrictive:

- `public.profiles`: backend reads `role`; browser access should remain governed by existing profile policies.
- `public.mail_accounts`: backend service client reads/writes all fields; authenticated browser users may select only the safe granted columns, never `credential_secret_id`.
- `public.mail_account_members`: backend service client manages memberships; authenticated users may read only their own/permitted membership rows through RLS.
- `public.mail_identities`: backend service client creates the default identity and validates selected identities; authenticated users may read identities only for permitted mailboxes.
- `public.mail_audit_log`: backend service client writes audit entries; authenticated users may read only permitted non-sensitive audit rows.
- RPC wrappers `public.mail_vault_create_secret`, `public.mail_vault_update_secret`, `public.mail_vault_read_secret`, and `public.mail_vault_delete_secret`: executable only by `service_role`.

In Supabase, check table API availability from the Table Editor/API settings for each public table. Do not enable browser access by broad grants. Confirm:

- RLS is enabled on all mail tables.
- `anon` has no mail-table grants.
- `authenticated` has only the explicit safe select grants from the migration.
- `credential_secret_id` is not granted to `authenticated`.
- The `vault` schema and `vault.decrypted_secrets` are not exposed to browser clients.
- Vault wrapper functions are not executable by `anon` or `authenticated`.
- The backend server secret/service-role key can execute the Vault wrapper RPCs.

## Server Environment

Create `/etc/vayvyx-mail.env` from `deployment/vayvyx-mail.env.example`.

Required values:

```env
NODE_ENV=production
PORT=4174
HOST=127.0.0.1
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_or_anon_key
SUPABASE_SECRET_KEY=your_supabase_secret_or_service_role_key
MAIL_MAX_ACTIVE_CONNECTIONS=8
MAIL_CONNECTION_IDLE_MS=120000
MAIL_CONNECTION_TEST_TIMEOUT_MS=15000
```

Do not use a `VITE_` prefix for backend secrets. Do not commit `/etc/vayvyx-mail.env`.

## Local Commands

```bash
npm install
npm run test
npm run build
npm run dev:server
```

For local backend testing without `/etc/vayvyx-mail.env`, set `VAYVYX_MAIL_ENV_FILE` to a private local file path.

## VM Deployment Commands

From the VM project directory:

```bash
cd /var/www/VayvyxWebsite/vayvyx-web
node --version
npm --version
git pull
npm ci
npm run test
npm run build
sudo install -m 600 deployment/vayvyx-mail.env.example /etc/vayvyx-mail.env
sudo nano /etc/vayvyx-mail.env
sudo cp deployment/vayvyx-mail.service.example /etc/systemd/system/vayvyx-mail.service
sudo systemctl daemon-reload
sudo systemctl enable --now vayvyx-mail
sudo systemctl status vayvyx-mail
```

Update the real Caddyfile manually using `deployment/Caddyfile.mail.example` as the reference, then reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Health Endpoint

`GET /api/mail/health` returns only:

```json
{ "status": "ok" }
```

It does not test Supabase, IMAP, SMTP, Vault, or any mailbox identity.

## Phase 1 Admin API

All `/api/mail/admin/*` routes require a valid Supabase bearer token. Platform admins can list and create mailboxes. Platform admins and mailbox owners can update a mailbox, rotate credentials, test IMAP/SMTP auth, and manage members, with final-owner protection enforced.

Implemented endpoints:

- `GET /api/mail/admin/accounts`
- `POST /api/mail/admin/accounts`
- `PATCH /api/mail/admin/accounts/:mailAccountId`
- `POST /api/mail/admin/accounts/:mailAccountId/credentials`
- `POST /api/mail/admin/accounts/:mailAccountId/test-imap`
- `POST /api/mail/admin/accounts/:mailAccountId/test-smtp`
- `POST /api/mail/admin/accounts/:mailAccountId/members`
- `PATCH /api/mail/admin/accounts/:mailAccountId/members/:userId`
- `DELETE /api/mail/admin/accounts/:mailAccountId/members/:userId`
- `GET /api/mail/admin/users/search?q=...`

The backend never returns mailbox passwords, decrypted Vault values, service keys, or `credential_secret_id`.

`GET /api/mail/access` returns safe authorization metadata for route bootstrapping, including zero-mailbox platform-admin setup:

```json
{
  "authenticated": true,
  "platformAdmin": true,
  "hasMailAccess": false,
  "mailboxCount": 0
}
```

It requires a valid bearer token and derives platform-admin status from `public.profiles.role` server-side.

## Phase 2 Mail API

Implemented backend mail-operation endpoints:

- `GET /api/mail/accounts`
- `GET /api/mail/unified/messages`
- `GET /api/mail/accounts/:mailAccountId/folders`
- `GET /api/mail/accounts/:mailAccountId/messages`
- `GET /api/mail/accounts/:mailAccountId/messages/:uid`
- `GET /api/mail/accounts/:mailAccountId/messages/:uid/attachments/:attachmentId`
- `PATCH /api/mail/accounts/:mailAccountId/messages/:uid/read`
- `PATCH /api/mail/accounts/:mailAccountId/messages/:uid/flag`
- `POST /api/mail/accounts/:mailAccountId/messages/:uid/archive`
- `POST /api/mail/accounts/:mailAccountId/messages/:uid/trash`
- `POST /api/mail/accounts/:mailAccountId/messages/:uid/move`
- `POST /api/mail/accounts/:mailAccountId/send`

All message locators use `mailAccountId + folder + uid`. UIDs are never treated as globally unique.

## Role Requirements

- `viewer`: accounts, folders, message summaries, message detail, attachments.
- `sender`: viewer permissions plus send, read/unread, and flag/unflag.
- `manager`: sender permissions plus archive, trash, and move.
- `owner`: manager permissions plus Phase 1 mailbox administration.
- `admin`: all active mailboxes, still subject to backend validation and active mailbox checks.

## HTML And Remote Images

Email HTML is hostile input. The backend sanitizes message HTML and outbound HTML with `sanitize-html`, removes scriptable or form-capable tags, strips event handlers, blocks `javascript:` URLs, rewrites links with `target="_blank"` and `rel="noopener noreferrer"`, and replaces remote HTTP/HTTPS images with a safe placeholder. The response includes `hasRemoteImages` so Phase 3 can add a deliberate "Load remote images" action without rendering raw HTML.

## Attachments

Attachments are streamed through the backend after viewer authorization. Responses include `Content-Type`, `Content-Disposition`, and `X-Content-Type-Options: nosniff`. Filenames are sanitized and no permanent public URLs are created. Attachment IDs are validated and must not contain filesystem paths.

## Sending And Sent Folder

`POST /api/mail/accounts/:mailAccountId/send` supports JSON bodies and multipart bodies with a `payload` JSON field plus `attachments`. It validates recipients, subject/header fields, mailbox identity ownership, body size, and per-mailbox attachment limits. The current Phase 2 backend sends through the selected mailbox SMTP credentials after authorization. Optional Sent-folder append is not enabled yet; delivery success is reported from SMTP only, and Sent-folder behavior should be revisited with provider-specific testing before enabling automatic append.

## Unified Inbox

Unified Inbox reads active authorized mailboxes only, limits mailbox fan-out to 20 mailboxes per request, limits mailbox concurrency to 3, merges summaries by message date, and returns generic per-mailbox failure records without raw IMAP errors. Pagination across independent IMAP sources is best-effort in this phase and currently returns `nextCursor: null`.

## Rate Limits And Errors

The backend applies a general authenticated limit of 180 requests per minute per user/network context. Error responses use stable codes such as `AUTH_REQUIRED`, `ACCESS_DENIED`, `MAILBOX_INACTIVE`, `INVALID_REQUEST`, `ATTACHMENT_TOO_LARGE`, `RATE_LIMITED`, `MAILBOX_UNAVAILABLE`, and `SEND_FAILED`.

## Logging And Troubleshooting

Server logs may include generic technical errors and route failures. Logs must not include passwords, Vault values, bearer tokens, raw MIME, message bodies, attachment contents, or full authentication headers.

## Safe Rollback

To roll back the backend without changing existing public pages:

```bash
sudo systemctl stop vayvyx-mail
sudo systemctl disable vayvyx-mail
```

Then remove the `/api/mail/*` reverse proxy block from Caddy and reload Caddy. The existing static Vayvyx website remains served from `dist/`.

## Mail Server Defaults

Use these as UI/API defaults when creating a mailbox, while allowing admins to change them per mailbox:

- IMAP host: `sunfire.mxrouting.net`
- IMAP port: `993`
- IMAP secure: `true`
- SMTP host: `sunfire.mxrouting.net`
- SMTP port: `465`
- SMTP secure: `true`

## Phase 2 And Phase 3

Phase 2 adds user-accessible mail operations, message retrieval, safe HTML rendering, attachment streaming, mailbox actions, sending, and Unified Inbox.

Phase 3 adds `/mail`, `/admin/mail/settings`, mailbox UI components, account-page mail actions, and responsive layouts.

## Phase 3 Frontend

Routes:

- `/mail`: authenticated Vayvyx Mail workspace.
- `/admin/mail/settings`: company mailbox settings for platform admins.
- `/account`: keeps the existing license panel and adds mail actions only after backend authorization succeeds.

The frontend calls `/api/mail/accounts` before showing mailbox access. It does not reveal mailbox names or counts before the backend returns authorized mailbox metadata. Route checks are only user-experience protections; every mailbox action is still authorized by the backend.

Role-based controls:

- `viewer`: read-only folders, messages, and attachments.
- `sender`: compose, reply, reply all, forward, read/unread, flag/unflag.
- `manager`: sender controls plus archive, trash, and move.
- `owner` and `admin`: manager controls plus access to supported mailbox settings.

The desktop mail layout uses three operational panels: mailbox/folder navigation, message list, and message viewer. Mobile uses one primary panel at a time with back navigation.

Remote images remain blocked by default. The UI shows a short blocked-image notice when the backend reports `hasRemoteImages`.

Attachments download only after an explicit click. The frontend sends the bearer token in the request header, converts the response to a temporary Blob URL, triggers the browser download, and immediately revokes the URL.

Compose, reply, reply all, and forward use a plain-text composer. The selected sending mailbox is visible. The user cannot type an arbitrary From address. Draft content remains in component state after a recoverable send failure.

The admin settings page supports listing mailboxes, adding mailboxes, editing connection metadata, activating/deactivating, rotating credentials, testing IMAP/SMTP, and member access management through the safe user-search endpoint. It never displays saved passwords, Vault identifiers, or credential secret IDs. Password fields clear after submission handling.

New mailboxes get a default sender identity from `mail_accounts.email_address` and `mail_accounts.from_name`. Advanced alias and identity management remains future work. Sending may omit `identityId`; when `identityId` is supplied, the backend validates that it belongs to the selected mailbox.

Mailbox creation stores the submitted password in Vault, creates the mailbox, creates the default identity, and assigns ownership. If a later database step fails, the backend deletes the partially created mailbox row and compensates by deleting the unused Vault secret. Passwords are never returned.

Admin settings error states are intentionally generic and sanitized: access denied, session expired, migration/table unavailable, Vault/credential storage unavailable, duplicate mailbox, invalid settings, IMAP/SMTP test failure, and administrator access removed.

Known limitations shown accurately in the UI:

- Unified Inbox pagination is hidden unless a backend cursor exists. Phase 2 currently returns `nextCursor: null`.
- Sent-folder append is not enabled yet.
- Move uses the backend's native IMAP MOVE behavior.
- The React Router audit advisory remains unresolved for the current compatible package line.

## Frontend Testing

Run:

```bash
npm run lint
npm run test
npm run build
```

Frontend tests mock Supabase sessions and API responses. They do not contact real mailboxes and do not send real email.

## Manual Verification Checklist

1. Start the backend with `npm run dev:server`.
2. Start the frontend with `npm run dev`.
3. Sign in with a Supabase user.
4. Confirm `/account` still shows license information.
5. Confirm mail actions only appear after backend mail authorization.
6. Open `/mail` and verify assigned mailboxes, folders, message lists, and message detail.
7. Confirm remote-image notices appear when applicable.
8. Confirm attachment downloads prompt only after clicking.
9. Confirm sender/manager controls match the returned mailbox role.
10. Confirm `/admin/mail/settings` rejects non-admin users and lets platform admins manage safe mailbox metadata.

## Production Runbook

Do not copy environment secrets into the repository.

Production requires Node.js 24 LTS or newer and npm 11 or newer. The systemd example expects Node at `/usr/local/bin/node`.

### A. Pre-Deployment Backup

```bash
cd /var/www/VayvyxWebsite/vayvyx-web
git rev-parse HEAD
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-vayvyx-mail.$(date +%Y%m%d%H%M%S)
sudo tar -czf /var/backups/vayvyx-web-dist.$(date +%Y%m%d%H%M%S).tgz dist dist-server 2>/dev/null || true
```

### B. Git Deployment

```bash
cd /var/www/VayvyxWebsite/vayvyx-web
node --version
npm --version
git pull origin main
npm ci
npm run lint
npm run test
npm run build
```

`npm run build` must produce the backend entry file at:

```txt
/var/www/VayvyxWebsite/vayvyx-web/dist-server/index.js
```

### C. Supabase

1. Verify database backup availability in Supabase.
2. Enable Vault.
3. Apply `supabase/migrations/202607280001_mail_foundation.sql`.
4. Verify the Data API readiness checklist above.
5. Verify RLS is enabled on mail tables.
6. Verify Vault RPC permissions.
7. Promote Alexander:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where email = 'itsalexweber@gmail.com'
);
```

Verify:

```sql
select u.email, p.role
from auth.users u
join public.profiles p on p.id = u.id
where u.email = 'itsalexweber@gmail.com';
```

### D. Server Environment

```bash
sudo install -o root -g root -m 600 deployment/vayvyx-mail.env.example /etc/vayvyx-mail.env
sudo nano /etc/vayvyx-mail.env
```

Required:

```env
HOST=127.0.0.1
PORT=4174
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
MAIL_MAX_ACTIVE_CONNECTIONS=8
MAIL_CONNECTION_IDLE_MS=120000
MAIL_CONNECTION_TEST_TIMEOUT_MS=15000
```

Do not place mailbox passwords in `/etc/vayvyx-mail.env`.

### E. systemd

```bash
sudo cp deployment/vayvyx-mail.service.example /etc/systemd/system/vayvyx-mail.service
sudo systemctl daemon-reload
sudo systemctl enable vayvyx-mail
sudo systemctl start vayvyx-mail
sudo systemctl status vayvyx-mail
journalctl -u vayvyx-mail -n 100 --no-pager
```

### F. Local Backend Health

```bash
curl http://127.0.0.1:4174/api/mail/health
```

Expected:

```json
{"status":"ok"}
```

### G. Caddy

Place the `/api/mail/*` reverse proxy before the SPA fallback:

```caddy
handle /api/mail/* {
    reverse_proxy 127.0.0.1:4174
}
```

Then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### H. Public Health

```bash
curl https://vayvyx.com/api/mail/health
curl https://www.vayvyx.com/api/mail/health
```

### I. Browser Validation

Verify homepage, login, account, license display, request-demo, admin mail settings, and the mail application.

### J. First Mailbox

Add `beta@vayvyx.com`, test IMAP, test SMTP authentication, send a controlled external test, receive a test, reply, download a small attachment, mark read/unread, flag/unflag, archive, and trash.

### K. Second Mailbox

Add `support@vayvyx.com` independently, verify separate credentials, Unified Inbox, source labels, and selected-mailbox sending.

### L. User Isolation

Create or use a normal non-admin test account, assign only one mailbox, verify it cannot access another mailbox, verify it cannot open company mail settings, remove membership, and verify access is immediately removed.

### M. Rollback

```bash
sudo systemctl disable --now vayvyx-mail
sudo cp /etc/caddy/Caddyfile.pre-vayvyx-mail.<timestamp> /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
cd /var/www/VayvyxWebsite/vayvyx-web
git checkout <previous-commit>
npm ci
npm run build
```

Do not drop mail tables or Vault secrets as an emergency rollback step. Preserve data for investigation.
