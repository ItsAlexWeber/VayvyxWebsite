import { templateVariableLabel } from "./mailTemplateVariableUtils.ts";

type Props = {
  variableNames: string[];
  variables: Record<string, string>;
  missingVariables: string[];
  busy?: boolean;
  applyLabel?: string;
  onChange: (name: string, value: string) => void;
  onApply?: () => void;
};

export function MailTemplateFieldForm({
  variableNames,
  variables,
  missingVariables,
  busy = false,
  applyLabel = "Apply fields",
  onChange,
  onApply,
}: Props) {
  const missing = new Set(missingVariables);

  return (
    <div className="mail-template-field-form" aria-label="Template fields">
      {missingVariables.length > 0 && (
        <p className="mail-template-field-warning" role="alert">
          Complete required template fields: {missingVariables.map(templateVariableLabel).join(", ")}.
        </p>
      )}
      <div className="mail-template-field-grid">
        {variableNames.map((name) => {
          const isMissing = missing.has(name);
          return (
            <label key={name} className={isMissing ? "missing" : ""}>
              <span>{templateVariableLabel(name)}</span>
              <input
                value={variables[name] ?? ""}
                aria-invalid={isMissing}
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
