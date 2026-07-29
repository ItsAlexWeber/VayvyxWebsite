# Vayvyx Mail Template Integrity

Use this only with the original, complete Vayvyx Beta Access Ready HTML source.
Do not reconstruct the HTML from a rendered preview or plain-text fallback.

## Check The Stored Record

```sql
select
  id,
  name,
  length(html_content) as html_character_count,
  length(plain_text_content) as text_character_count,
  html_content like '%Your Vayvyx access is ready.%' as has_hero,
  html_content like '%YOUR LOGIN INFORMATION%' as has_login_card,
  html_content like '%GETTING STARTED%' as has_getting_started,
  html_content like '%How to access your account%' as has_login_instructions,
  html_content like '%FORGOT OR NEED TO RESET YOUR PASSWORD?%' as has_password_reset,
  (html_content like '%PRIVATE & CONFIDENTIAL%' or html_content like '%PRIVATE &amp; CONFIDENTIAL%') as has_confidential_notice,
  html_content like '%Welcome to the beta%' as has_signoff,
  html_content like '%CONSTRUCTION INTELLIGENCE%' as has_footer
from public.mail_templates
where name in ('vayvyx-beta-access-ready', 'Beta Access Ready')
  and is_active = true;
```

If any marker is false, replace `html_content` from the original canonical
HTML file and keep `plain_text_content` as the separate text fallback.

## Repair The Record

```sql
update public.mail_templates
set
  subject_template = 'Your Vayvyx Private Beta Access Is Ready',
  html_content = $html$PASTE ORIGINAL COMPLETE HTML DOCUMENT HERE$html$,
  plain_text_content = $text$PASTE SEPARATE PLAIN-TEXT FALLBACK HERE$text$,
  updated_at = now()
where name in ('vayvyx-beta-access-ready', 'Beta Access Ready')
  and is_active = true;
```

After repair, rerun the check query and confirm every marker is true.
