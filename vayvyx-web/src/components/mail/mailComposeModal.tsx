import {
  Bold,
  FileText,
  Italic,
  LayoutTemplate,
  Link,
  List,
  ListOrdered,
  Paperclip,
  Redo2,
  Save,
  Send,
  Trash2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MailAccountSummary,
  MailMessageDetail,
  MailTemplateDetail,
  MailTemplateRendered,
  SendMessageRequest,
  SendMessageResult,
} from "../../types/mail.ts";
import {
  clearMailComposeDraft,
  mailComposeDraftStorageKey,
  readMailComposeDraftAttachments,
  readMailComposeDraftMetadata,
  saveMailComposeDraft,
  type StoredMailComposeDraft,
} from "./mailDraftStorage.ts";
import { MailTemplateFieldForm } from "./mailTemplateFieldForm.tsx";
import { MailTemplatePicker } from "./mailTemplatePicker.tsx";
import { htmlToPlainText, textToEmailHtml } from "./mailTemplateUtils.ts";
import {
  defaultSubjectForTemplate,
  hasUnresolvedTemplateTokens,
  missingTemplateVariables,
  previewTemplateVariables,
} from "./mailTemplateVariableUtils.ts";
import { buildEmailSrcDoc } from "./safeEmailHtml.ts";

type Props = {
  account: MailAccountSummary;
  mode: SendMessageRequest["mode"];
  originalMessage: MailMessageDetail | null;
  onClose: () => void;
  onSend: (input: SendMessageRequest, attachments: File[]) => Promise<SendMessageResult>;
};

type SelectedTemplate = Pick<MailTemplateDetail, "id" | "name" | "subjectTemplate" | "variables">;

export function MailComposeModal({
  account,
  mode,
  originalMessage,
  onClose,
  onSend,
}: Props) {
  const draftStorageKey = mailComposeDraftStorageKey(account.id, mode);
  const initialDraft = useMemo(
    () => readMailComposeDraftMetadata(draftStorageKey),
    [draftStorageKey]
  );
  const initialBody = initialDraft?.body ?? prefillBody(mode, originalMessage);
  const restoredTemplate = initialDraft?.templateId
    ? {
        id: initialDraft.templateId,
        name: initialDraft.templateName ?? "Saved template",
        subjectTemplate: initialDraft.templateSubjectTemplate,
        variables: initialDraft.templateVariableNames,
      }
    : null;

  const [to, setTo] = useState(initialDraft?.to ?? prefillTo(mode, originalMessage, account.emailAddress));
  const [cc, setCc] = useState(initialDraft?.cc ?? prefillCc(mode, originalMessage, account.emailAddress));
  const [bcc, setBcc] = useState(initialDraft?.bcc ?? "");
  const [showCcBcc, setShowCcBcc] = useState(
    initialDraft?.showCcBcc ?? Boolean(prefillCc(mode, originalMessage, account.emailAddress))
  );
  const [subject, setSubject] = useState(initialDraft?.subject ?? prefillSubject(mode, originalMessage));
  const [subjectEdited, setSubjectEdited] = useState(Boolean(initialDraft?.subject));
  const [body, setBody] = useState(initialBody);
  const [richHtml, setRichHtml] = useState(initialDraft?.richHtml ?? (initialBody ? textToEmailHtml(initialBody) : ""));
  const [htmlBody, setHtmlBody] = useState(initialDraft?.htmlBody ?? "");
  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(restoredTemplate);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>(
    initialDraft?.templateVariables ?? {}
  );
  const [editingTemplateFields, setEditingTemplateFields] = useState(
    restoredTemplate ? missingTemplateVariables(restoredTemplate.variables, initialDraft?.templateVariables ?? {}).length > 0 : false
  );
  const [showTemplates, setShowTemplates] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templatePreviewHeight, setTemplatePreviewHeight] = useState(520);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const templatePreviewRef = useRef<HTMLIFrameElement | null>(null);

  const templateMissingVariables = useMemo(
    () => selectedTemplate ? missingTemplateVariables(selectedTemplate.variables, templateVariables) : [],
    [selectedTemplate, templateVariables]
  );

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  useEffect(() => {
    let active = true;
    readMailComposeDraftAttachments(draftStorageKey).then((storedAttachments) => {
      if (active && storedAttachments.length > 0) setAttachments(storedAttachments);
    });
    return () => {
      active = false;
    };
  }, [draftStorageKey]);

  useEffect(() => {
    const timer = window.setTimeout(resizeTemplatePreview, 40);
    return () => window.clearTimeout(timer);
  }, [htmlBody]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (selectedTemplate) {
      const missing = missingTemplateVariables(selectedTemplate.variables, templateVariables);
      if (missing.length > 0) {
        setEditingTemplateFields(true);
        setStatus("Complete the missing template fields before sending.");
        return;
      }

      if (hasUnresolvedTemplateTokens(subject, body, htmlBody)) {
        setEditingTemplateFields(true);
        setStatus("Resolve every template placeholder before sending.");
        return;
      }
    }

    setSending(true);

    try {
      const result = await onSend(
        {
          mode,
          to: splitAddresses(to),
          cc: splitAddresses(cc),
          bcc: splitAddresses(bcc),
          subject,
          textBody: body,
          sanitizedHtmlBody: selectedTemplate ? htmlBody : normalizedRichHtml(richHtml, body),
          templateId: selectedTemplate?.id,
          templateVariables,
          originalFolder: originalMessage?.folder,
          originalUid: originalMessage?.uid,
          inReplyTo: mode === "compose" ? undefined : originalMessage?.messageId ?? undefined,
          references: mode === "compose" ? [] : originalMessage?.references ?? [],
        },
        attachments
      );
      await clearMailComposeDraft(draftStorageKey);
      setStatus(result.sentFolderWarning ?? "Message sent.");
      window.setTimeout(onClose, 500);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Send failed. Your draft is still here.");
    } finally {
      setSending(false);
    }
  }

  async function saveDraft() {
    setSavingDraft(true);
    setStatus("");
    try {
      await saveMailComposeDraft(
        draftStorageKey,
        buildDraft({
          accountId: account.id,
          mode,
          to,
          cc,
          bcc,
          showCcBcc,
          subject,
          body,
          richHtml,
          htmlBody,
          selectedTemplate,
          templateVariables,
          attachments,
        }),
        attachments
      );
      setStatus("Draft saved.");
    } catch {
      setStatus("Draft could not be saved in this browser.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function applyTemplateFields() {
    if (!selectedTemplate) return;
    const missing = missingTemplateVariables(selectedTemplate.variables, templateVariables);
    setStatus("");

    if (missing.length > 0) {
      setStatus("Complete the missing template fields before applying.");
      return;
    }

    setTemplateBusy(true);
    try {
      const rendered = await (await getMailApi()).renderTemplatePreview(selectedTemplate.id, templateVariables);
      if (rendered.unresolvedVariables.length > 0) {
        setStatus("Complete the missing template fields before applying.");
        return;
      }
      updateRenderedTemplate(rendered, selectedTemplate);
      setEditingTemplateFields(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template fields could not be applied.");
    } finally {
      setTemplateBusy(false);
    }
  }

  function updateRenderedTemplate(rendered: MailTemplateRendered, template: SelectedTemplate) {
    const nextSubject = rendered.subject || defaultSubjectForTemplate(template);
    if (nextSubject && (!subjectEdited || subject.trim().length === 0)) {
      setSubject(nextSubject);
      setSubjectEdited(false);
    }
    setBody(rendered.plainTextContent || htmlToPlainText(rendered.htmlContent));
    setHtmlBody(rendered.htmlContent);
  }

  function applyTemplate(
    rendered: MailTemplateRendered,
    template: MailTemplateDetail,
    variables: Record<string, string>
  ) {
    const selected = {
      id: template.id,
      name: template.name,
      subjectTemplate: template.subjectTemplate,
      variables: template.variables,
    };
    const nextSubject = rendered.subject || defaultSubjectForTemplate(template);
    setSelectedTemplate(selected);
    setTemplateVariables(variables);
    setEditingTemplateFields(false);
    setBody(rendered.plainTextContent || htmlToPlainText(rendered.htmlContent));
    setHtmlBody(rendered.htmlContent);
    setRichHtml("");
    if (nextSubject) {
      setSubject(nextSubject);
      setSubjectEdited(false);
    }
  }

  function removeTemplate() {
    setSelectedTemplate(null);
    setTemplateVariables({});
    setEditingTemplateFields(false);
    setHtmlBody("");
    setRichHtml(body ? textToEmailHtml(body) : "");
    setStatus("");
  }

  function resizeTemplatePreview() {
    const documentElement = templatePreviewRef.current?.contentDocument?.documentElement;
    const documentBody = templatePreviewRef.current?.contentDocument?.body;
    const contentHeight = Math.max(
      documentElement?.scrollHeight ?? 0,
      documentBody?.scrollHeight ?? 0,
      520
    );
    setTemplatePreviewHeight(contentHeight);
  }

  function attachFiles(files: FileList | null) {
    const nextFiles = Array.from(files ?? []);
    if (nextFiles.length === 0) return;
    setAttachments((current) => [...current, ...nextFiles]);
    setStatus(`${nextFiles.length} ${nextFiles.length === 1 ? "file" : "files"} attached.`);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  return (
    <div className="mail-modal-backdrop" role="presentation">
      <section className="mail-compose" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header className="mail-compose-header">
          <div>
            <p className="mail-section-label">New message</p>
            <h2 id="compose-title">{modeLabel(mode)}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close compose">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="mail-compose-fields">
            <div className="mail-compose-line">
              <span>From</span>
              <strong>{account.emailAddress}</strong>
            </div>
            <label className="mail-compose-line">
              <span>To</span>
              <input value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <button
              className="mail-compose-cc-toggle"
              type="button"
              onClick={() => setShowCcBcc((value) => !value)}
              aria-expanded={showCcBcc}
            >
              CC/BCC
            </button>
            {showCcBcc && (
              <div className="mail-compose-copy-fields">
                <label className="mail-compose-line">
                  <span>Cc</span>
                  <input value={cc} onChange={(event) => setCc(event.target.value)} />
                </label>
                <label className="mail-compose-line">
                  <span>Bcc</span>
                  <input value={bcc} onChange={(event) => setBcc(event.target.value)} />
                </label>
              </div>
            )}
            <label className="mail-compose-line">
              <span>Subject</span>
              <input
                value={subject}
                onChange={(event) => {
                  setSubject(event.target.value);
                  setSubjectEdited(true);
                }}
              />
            </label>
            {selectedTemplate && (
              <div className="mail-selected-template">
                <span>Template: <strong>{selectedTemplate.name}</strong></span>
                <button
                  type="button"
                  onClick={() => setEditingTemplateFields((value) => !value)}
                  aria-expanded={editingTemplateFields}
                >
                  Edit fields
                </button>
                <button type="button" onClick={removeTemplate}>
                  Remove template
                </button>
              </div>
            )}
          </div>

          <div className="mail-compose-body-workspace">
            {selectedTemplate && editingTemplateFields && (
              <MailTemplateFieldForm
                variableNames={selectedTemplate.variables}
                variables={templateVariables}
                missingVariables={templateMissingVariables}
                busy={templateBusy}
                onApply={applyTemplateFields}
                onChange={(name, value) =>
                  setTemplateVariables((current) => ({ ...current, [name]: value }))
                }
              />
            )}

            {selectedTemplate ? (
              <div className="mail-compose-template-shell">
                {templateMissingVariables.length > 0 && (
                  <p className="mail-template-field-warning" role="alert">
                    Complete every template field before sending.
                  </p>
                )}
                <iframe
                  ref={templatePreviewRef}
                  className="mail-compose-template-preview"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  scrolling="no"
                  title="Rendered email body"
                  style={{ height: `${templatePreviewHeight}px` }}
                  srcDoc={buildEmailSrcDoc(
                    htmlBody || buildMissingTemplatePreview(selectedTemplate.variables, templateVariables),
                    false
                  )}
                  onLoad={resizeTemplatePreview}
                />
              </div>
            ) : (
              <RichTextBodyEditor
                html={richHtml}
                onChange={(nextHtml, nextText) => {
                  setRichHtml(nextHtml);
                  setBody(nextText);
                }}
              />
            )}
          </div>

          <div className="mail-compose-attachments" aria-label="Attachments">
            <input
              ref={attachmentInputRef}
              className="mail-file-input"
              type="file"
              multiple
              aria-label="Attachment files"
              onChange={(event) => attachFiles(event.target.files)}
            />
            <button type="button" onClick={() => attachmentInputRef.current?.click()}>
              <Paperclip size={16} />
              Attach files
            </button>
            {attachments.length > 0 && (
              <ul>
                {attachments.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <FileText size={15} />
                    <span>
                      <strong>{file.name}</strong>
                      <small>{formatFileSize(file.size)}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`Remove ${file.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="mail-compose-actions">
            <button type="button" onClick={() => setShowTemplates(true)}>
              <LayoutTemplate size={17} />
              Templates
            </button>
            <button className="mail-primary-action" type="submit" disabled={sending}>
              <Send size={17} />
              {sending ? "Sending..." : "Send"}
            </button>
            <button type="button" onClick={saveDraft} disabled={savingDraft}>
              <Save size={17} />
              {savingDraft ? "Saving..." : "Save Draft"}
            </button>
            <button type="button" onClick={onClose} disabled={sending}>
              Cancel
            </button>
          </footer>
        </form>

        {status && <p className="mail-status" aria-live="polite">{status}</p>}
        {showTemplates && (
          <MailTemplatePicker
            account={account}
            currentSubject={subject}
            currentTextBody={body}
            currentHtmlBody={selectedTemplate ? htmlBody : richHtml}
            currentTo={to}
            onClose={() => setShowTemplates(false)}
            onUse={(rendered, template, variables) => {
              applyTemplate(rendered, template, variables);
              setShowTemplates(false);
            }}
          />
        )}
      </section>
    </div>
  );
}

function RichTextBodyEditor({
  html,
  onChange,
}: {
  html: string;
  onChange: (html: string, text: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [html]);

  function emitChange() {
    const editor = editorRef.current;
    onChange(editor?.innerHTML ?? "", editor?.textContent ?? "");
  }

  function runCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emitChange();
  }

  function addLink() {
    const href = window.prompt("Link URL");
    if (!href || !isSafeComposeLink(href)) return;
    runCommand("createLink", href);
  }

  return (
    <div className="mail-rich-editor-shell">
      <div className="mail-rich-editor-toolbar" aria-label="Message formatting">
        <button type="button" aria-label="Bold" title="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("bold")}>
          <Bold size={15} />
        </button>
        <button type="button" aria-label="Italic" title="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("italic")}>
          <Italic size={15} />
        </button>
        <button type="button" aria-label="Underline" title="Underline" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("underline")}>
          <Underline size={15} />
        </button>
        <button type="button" aria-label="Bulleted list" title="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("insertUnorderedList")}>
          <List size={15} />
        </button>
        <button type="button" aria-label="Numbered list" title="Numbered list" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("insertOrderedList")}>
          <ListOrdered size={15} />
        </button>
        <button type="button" aria-label="Link" title="Link" onMouseDown={(event) => event.preventDefault()} onClick={addLink}>
          <Link size={15} />
        </button>
        <button type="button" aria-label="Undo" title="Undo" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("undo")}>
          <Undo2 size={15} />
        </button>
        <button type="button" aria-label="Redo" title="Redo" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("redo")}>
          <Redo2 size={15} />
        </button>
      </div>
      <div
        ref={editorRef}
        className="mail-rich-editor"
        role="textbox"
        aria-label="Message body"
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
      />
    </div>
  );
}

function splitAddresses(value: string) {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function prefillTo(mode: SendMessageRequest["mode"], message: MailMessageDetail | null, self: string) {
  if (!message || mode === "compose" || mode === "forward") return "";
  const source = message.replyTo.length > 0 ? message.replyTo : message.from;
  return source.filter((item) => item.address.toLowerCase() !== self.toLowerCase()).map((item) => item.address).join(", ");
}

function prefillCc(mode: SendMessageRequest["mode"], message: MailMessageDetail | null, self: string) {
  if (!message || mode !== "replyAll") return "";
  const excluded = new Set([self.toLowerCase()]);
  return [...message.to, ...message.cc]
    .filter((item) => !excluded.has(item.address.toLowerCase()))
    .map((item) => item.address)
    .join(", ");
}

function prefillSubject(mode: SendMessageRequest["mode"], message: MailMessageDetail | null) {
  if (!message) return "";
  if (mode === "forward") return `Fwd: ${message.subject}`;
  if (mode === "reply" || mode === "replyAll") return message.subject.toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject}`;
  return "";
}

function prefillBody(mode: SendMessageRequest["mode"], message: MailMessageDetail | null) {
  if (mode !== "forward" || !message) return "";
  return `\n\nForwarded message:\nFrom: ${message.senderAddress ?? "Unknown"}\nSubject: ${message.subject}\n\n${message.textBody}`;
}

function modeLabel(mode: SendMessageRequest["mode"]) {
  if (mode === "replyAll") return "Reply all";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function normalizedRichHtml(html: string, text: string) {
  return text.trim().length > 0 ? html || textToEmailHtml(text) : undefined;
}

function buildDraft(input: {
  accountId: string;
  mode: SendMessageRequest["mode"];
  to: string;
  cc: string;
  bcc: string;
  showCcBcc: boolean;
  subject: string;
  body: string;
  richHtml: string;
  htmlBody: string;
  selectedTemplate: SelectedTemplate | null;
  templateVariables: Record<string, string>;
  attachments: File[];
}): StoredMailComposeDraft {
  return {
    version: 1,
    accountId: input.accountId,
    mode: input.mode,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    showCcBcc: input.showCcBcc,
    subject: input.subject,
    body: input.body,
    richHtml: input.richHtml,
    htmlBody: input.htmlBody,
    templateId: input.selectedTemplate?.id ?? null,
    templateName: input.selectedTemplate?.name ?? null,
    templateSubjectTemplate: input.selectedTemplate?.subjectTemplate ?? null,
    templateVariables: input.templateVariables,
    templateVariableNames: input.selectedTemplate?.variables ?? [],
    attachments: input.attachments.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    })),
    savedAt: new Date().toISOString(),
  };
}

function buildMissingTemplatePreview(variableNames: string[], variables: Record<string, string>) {
  const previewVariables = previewTemplateVariables(variableNames, variables);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fb;padding:24px">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #d8dee9;padding:24px">
            <tr>
              <td style="font-family:Arial,sans-serif;color:#1b2430;font-size:15px;line-height:1.5">
                ${variableNames.map((name) => `<p><strong>${escapeHtmlForPreview(name)}:</strong> ${escapeHtmlForPreview(previewVariables[name] ?? "")}</p>`).join("")}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function escapeHtmlForPreview(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function isSafeComposeLink(value: string) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

async function getMailApi() {
  return (await import("../../lib/mailApi.ts")).mailApi;
}
