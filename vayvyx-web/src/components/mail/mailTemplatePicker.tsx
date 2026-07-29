import { Copy, Download, Eye, FileUp, Save, Search, Trash2, Upload, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MailAccountSummary,
  MailTemplateDetail,
  MailTemplateRendered,
  MailTemplateScope,
  MailTemplateSummary,
} from "../../types/mail.ts";
import { buildEmailSrcDoc } from "./safeEmailHtml.ts";
import { textToEmailHtml } from "./mailTemplateUtils.ts";

type Props = {
  account: MailAccountSummary;
  currentSubject: string;
  currentTextBody: string;
  currentHtmlBody: string;
  onUse: (
    rendered: MailTemplateRendered,
    template: MailTemplateDetail,
    variables: Record<string, string>
  ) => void;
  onClose: () => void;
};

type Tab = "personal" | "company" | "recent";

export function MailTemplatePicker({
  account,
  currentSubject,
  currentTextBody,
  currentHtmlBody,
  onUse,
  onClose,
}: Props) {
  const [templates, setTemplates] = useState<MailTemplateSummary[]>([]);
  const [selected, setSelected] = useState<MailTemplateDetail | null>(null);
  const [tab, setTab] = useState<Tab>("personal");
  const [search, setSearch] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MailTemplateRendered | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<MailTemplateDetail | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const renderPreview = useCallback(
    async (templateId: string, nextVariables: Record<string, string>) => {
      try {
        setPreview(await (await getMailApi()).renderTemplatePreview(templateId, nextVariables));
      } catch {
        setPreview(null);
      }
    },
    []
  );

  const selectTemplate = useCallback(
    async (templateId: string) => {
      setStatus("");
      try {
      const detail = await (await getMailApi()).getTemplate(templateId);
        const nextVariables = Object.fromEntries(
          detail.variables.map((name) => [name, ""])
        );
        setSelected(detail);
        setEditDraft(detail);
        setEditing(false);
        setVariables(nextVariables);
        await renderPreview(detail.id, nextVariables);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Template could not be opened.");
      }
    },
    [renderPreview]
  );

  const loadTemplates = useCallback(async () => {
    setStatus("");
    try {
      const nextTemplates = await (await getMailApi()).getTemplates();
      setTemplates(nextTemplates);
      return nextTemplates;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Templates are unavailable.");
      return [];
    }
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      loadTemplates().then((nextTemplates) => {
        if (active && nextTemplates[0]) {
          void selectTemplate(nextTemplates[0].id);
        }
      });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loadTemplates, selectTemplate]);

  const visibleTemplates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return templates
      .filter((template) => {
        if (tab === "recent") return recentIds.includes(template.id);
        return template.scope === tab;
      })
      .filter((template) => {
        if (!normalizedSearch) return true;
        return [template.name, template.description ?? "", template.subjectTemplate ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      });
  }, [recentIds, search, tab, templates]);

  async function useTemplate() {
    if (!selected) return;
    setBusy(true);
    setStatus("");
    try {
      const rendered = await (await getMailApi()).renderTemplatePreview(selected.id, variables);
      if (rendered.unresolvedVariables.length > 0) {
        setPreview(rendered);
        setStatus("Complete the missing variables before using this template.");
        return;
      }
      setRecentIds((ids) => [selected.id, ...ids.filter((id) => id !== selected.id)].slice(0, 8));
      onUse(rendered, selected, variables);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template could not be used.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrentDraft() {
    const name = window.prompt("Template name");
    if (!name) return;
    setBusy(true);
    setStatus("");
    try {
      const created = await (await getMailApi()).createTemplate({
        name,
        description: null,
        subjectTemplate: currentSubject.trim() || null,
        htmlContent: currentHtmlBody || textToEmailHtml(currentTextBody),
        plainTextContent: currentTextBody,
        scope: "personal",
        defaultMailAccountId: account.id,
      });
      await loadTemplates();
      await selectTemplate(created.id);
      setStatus("Template saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdits() {
    if (!editDraft) return;
    setBusy(true);
    setStatus("");
    try {
      const updated = await (await getMailApi()).updateTemplate(editDraft.id, {
        name: editDraft.name,
        description: editDraft.description,
        subjectTemplate: editDraft.subjectTemplate,
        htmlContent: editDraft.htmlContent,
        plainTextContent: editDraft.plainTextContent,
        scope: editDraft.scope === "system" ? undefined : editDraft.scope,
        defaultMailAccountId: editDraft.defaultMailAccountId,
      });
      setSelected(updated);
      setEditDraft(updated);
      setEditing(false);
      await loadTemplates();
      setStatus("Template updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function duplicateSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      const copy = await (await getMailApi()).duplicateTemplate(selected.id, {
        scope: selected.scope === "system" ? "personal" : selected.scope,
        defaultMailAccountId: selected.scope === "company" ? selected.defaultMailAccountId : account.id,
      });
      await loadTemplates();
      await selectTemplate(copy.id);
      setStatus("Template duplicated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template could not be duplicated.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selected || !window.confirm("Delete this template?")) return;
    setBusy(true);
    try {
      await (await getMailApi()).deleteTemplate(selected.id);
      setSelected(null);
      setEditDraft(null);
      await loadTemplates();
      setStatus("Template deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function exportSelected() {
    if (!selected) return;
    try {
      const exported = await (await getMailApi()).exportTemplate(selected.id);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.filename;
      link.click();
      URL.revokeObjectURL(url);
      setStatus("Template exported.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template could not be exported.");
    }
  }

  async function uploadAsset(file: File | undefined) {
    if (!selected || !file) return;
    setBusy(true);
    try {
      await (await getMailApi()).uploadTemplateAsset(selected.id, file);
      await selectTemplate(selected.id);
      setStatus("Asset uploaded. Use its CID in an image src.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Asset could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mail-template-picker" aria-label="Email templates">
      <header className="mail-template-picker-header">
        <div>
          <p className="mail-section-label">Templates</p>
          <h3>Email template library</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close templates">
          <X size={17} />
        </button>
      </header>

      <div className="mail-template-tabs" role="tablist" aria-label="Template scope">
        {(["personal", "company", "recent"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? "active" : ""}
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
          >
            {item === "recent" ? "Recently used" : capitalize(item)}
          </button>
        ))}
      </div>

      <label className="mail-template-search">
        <Search size={15} />
        <input
          aria-label="Search templates"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search templates"
        />
      </label>

      <div className="mail-template-layout">
        <div className="mail-template-list" aria-label="Available templates">
          {visibleTemplates.length === 0 ? (
            <p className="mail-template-empty">No templates in this view.</p>
          ) : (
            visibleTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`mail-template-row ${selected?.id === template.id ? "active" : ""}`}
                onClick={() => void selectTemplate(template.id)}
              >
                <strong>{template.name}</strong>
                <small>{template.description ?? template.subjectTemplate ?? "No description"}</small>
                <em>{template.scope}</em>
              </button>
            ))
          )}
        </div>

        <div className="mail-template-detail">
          {selected ? (
            <>
              <div className="mail-template-actions">
                <button type="button" onClick={useTemplate} disabled={busy}>
                  <Wand2 size={15} /> Use
                </button>
                <button type="button" onClick={() => setEditing((value) => !value)}>
                  <Eye size={15} /> {editing ? "Preview" : "Edit"}
                </button>
                <button type="button" onClick={duplicateSelected} disabled={busy}>
                  <Copy size={15} /> Duplicate
                </button>
                <button type="button" onClick={exportSelected}>
                  <Download size={15} /> Export
                </button>
                {selected.scope !== "system" && (
                  <button type="button" onClick={deleteSelected} disabled={busy}>
                    <Trash2 size={15} /> Delete
                  </button>
                )}
              </div>

              {selected.variables.length > 0 && (
                <div className="mail-template-variables">
                  {selected.variables.map((name) => (
                    <label key={name}>
                      <span>{name}</span>
                      <input
                        value={variables[name] ?? ""}
                        onChange={(event) => {
                          const next = { ...variables, [name]: event.target.value };
                          setVariables(next);
                          void renderPreview(selected.id, next);
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}

              {editing && editDraft ? (
                <TemplateEditor
                  draft={editDraft}
                  accountId={account.id}
                  onChange={setEditDraft}
                  onSave={saveEdits}
                  onUpload={uploadAsset}
                  busy={busy}
                />
              ) : (
                <iframe
                  className="mail-template-preview-frame"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  title="Template preview"
                  srcDoc={buildEmailSrcDoc(preview?.htmlContent ?? selected.htmlContent, false)}
                />
              )}
            </>
          ) : (
            <p className="mail-template-empty">Select a template to preview it.</p>
          )}
        </div>
      </div>

      <footer className="mail-template-footer">
        <button type="button" onClick={saveCurrentDraft} disabled={busy}>
          <Save size={15} /> Save current draft as template
        </button>
        <label>
          <FileUp size={15} /> Import
          <input
            className="mail-template-file-input"
            type="file"
            accept=".html,.htm,.zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const name = window.prompt("Template name", file.name.replace(/\.(html?|zip)$/i, ""));
              if (!name) return;
              setBusy(true);
              getMailApi().then((api) => api.importTemplate({
                name,
                scope: "personal",
                defaultMailAccountId: account.id,
                file,
              }))
                .then(async (created) => {
                  await loadTemplates();
                  await selectTemplate(created.id);
                  setStatus("Template imported.");
                })
                .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Template could not be imported."))
                .finally(() => setBusy(false));
            }}
          />
        </label>
        {status && <p className="mail-status" aria-live="polite">{status}</p>}
      </footer>
    </section>
  );
}

function TemplateEditor({
  draft,
  accountId,
  onChange,
  onSave,
  onUpload,
  busy,
}: {
  draft: MailTemplateDetail;
  accountId: string;
  onChange: (value: MailTemplateDetail) => void;
  onSave: () => void;
  onUpload: (file: File | undefined) => void;
  busy: boolean;
}) {
  return (
    <div className="mail-template-editor">
      <input
        aria-label="Template name"
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
      />
      <input
        aria-label="Template description"
        value={draft.description ?? ""}
        onChange={(event) => onChange({ ...draft, description: event.target.value || null })}
      />
      <select
        aria-label="Template scope"
        value={draft.scope}
        disabled={draft.scope === "system"}
        onChange={(event) =>
          onChange({
            ...draft,
            scope: event.target.value as MailTemplateScope,
            defaultMailAccountId: event.target.value === "company" ? draft.defaultMailAccountId ?? accountId : accountId,
          })
        }
      >
        <option value="personal">Personal</option>
        <option value="company">Company</option>
        <option value="system">System</option>
      </select>
      <input
        aria-label="Template subject"
        value={draft.subjectTemplate ?? ""}
        onChange={(event) => onChange({ ...draft, subjectTemplate: event.target.value || null })}
      />
      <textarea
        aria-label="Template HTML source"
        value={draft.htmlContent}
        onChange={(event) => onChange({ ...draft, htmlContent: event.target.value })}
      />
      <textarea
        aria-label="Template plain-text fallback"
        value={draft.plainTextContent ?? ""}
        onChange={(event) => onChange({ ...draft, plainTextContent: event.target.value || null })}
      />
      <div className="mail-template-assets">
        <strong>Assets</strong>
        {draft.assets.length === 0 ? (
          <small>No managed assets.</small>
        ) : (
          draft.assets.map((asset) => (
            <small key={asset.id}>{asset.filename} | cid:{asset.cid}</small>
          ))
        )}
        <label>
          <Upload size={15} /> Upload asset
          <input
            className="mail-template-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => onUpload(event.target.files?.[0])}
          />
        </label>
      </div>
      <button className="mail-primary-action" type="button" onClick={onSave} disabled={busy || draft.scope === "system"}>
        Save
      </button>
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function getMailApi() {
  return (await import("../../lib/mailApi.ts")).mailApi;
}
