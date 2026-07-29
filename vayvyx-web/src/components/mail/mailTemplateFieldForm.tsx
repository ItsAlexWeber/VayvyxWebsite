import { templateVariableLabel } from "./mailTemplateVariableUtils.ts";

type Props = {
  variableNames: string[];
  variables: Record<string, string>;
  missingVariables: string[];
  invalidUrlVariables?: string[];
  busy?: boolean;
  applyLabel?: string;
  onChange: (name: string, value: string) => void;
  onApply?: () => void;
};

export function MailTemplateFieldForm({
  variableNames,
  variables,
  missingVariables,
  invalidUrlVariables = [],
  busy = false,
  applyLabel = "Apply fields",
  onChange,
  onApply,
}: Props) {
  const missing = new Set(missingVariables);
  const invalidUrls = new Set(invalidUrlVariables);

  return (
    <div className="mail-template-field-form" aria-label="Template fields">
      {missingVariables.length > 0 && (
        <p className="mail-template-field-warning" role="alert">
          Complete required template fields: {missingVariables.map(templateVariableLabel).join(", ")}.
        </p>
      )}
      {invalidUrlVariables.length > 0 && (
        <p className="mail-template-field-warning" role="alert">
          Login and password-reset links must be valid HTTPS URLs.
        </p>
      )}
      <div className="mail-template-field-grid">
        {variableNames.map((name) => {
          const isMissing = missing.has(name);
          const hasInvalidUrl = invalidUrls.has(name);
          return (
            <label key={name} className={isMissing || hasInvalidUrl ? "missing" : ""}>
              <span>{templateVariableLabel(name)}</span>
              <input
                value={variables[name] ?? ""}
                aria-invalid={isMissing || hasInvalidUrl}
                onChange={(event) => onChange(name, event.target.value)}
              />
            </label>
          );
        })}
      </div>
      {onApply && (
        <button className="mail-primary-action" type="button" onClick={onApply} disabled={busy}>
          {applyLabel}
        </button>
      )}
    </div>
  );
}
