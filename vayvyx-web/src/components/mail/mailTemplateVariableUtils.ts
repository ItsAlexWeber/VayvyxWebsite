import type { MailTemplateDetail } from "../../types/mail.ts";

const builtInVariables = new Set(["company_name", "support_email", "current_year"]);

const defaultTemplateValues: Record<string, string> = {
  company_name: "Vayvyx",
  current_year: String(new Date().getFullYear()),
  login_url: "https://vayvyx.com/login",
  password_reset_url: "https://vayvyx.com/reset-password",
  support_email: "support@vayvyx.com",
};

const variableLabels: Record<string, string> = {
  access_type: "Access type",
  first_name: "First name",
  login_email: "Login email",
  login_url: "Login URL",
  password_reset_url: "Password-reset URL",
  temporary_password: "Temporary password",
};

export function templateVariableLabel(name: string) {
  return variableLabels[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildTemplateVariableDraft(
  variableNames: string[],
  existingVariables: Record<string, string> = {},
  recipientSource = ""
) {
  const recipient = parseRecipientHint(recipientSource);
  const draft: Record<string, string> = {};

  for (const name of variableNames) {
    const existing = existingVariables[name];
    if (existing !== undefined) {
      draft[name] = existing;
      continue;
    }

    if (name === "first_name" && recipient.firstName) {
      draft[name] = recipient.firstName;
      continue;
    }

    if (name === "login_email" && recipient.email) {
      draft[name] = recipient.email;
      continue;
    }

    draft[name] = defaultTemplateValues[name] ?? "";
  }

  return draft;
}

export function missingTemplateVariables(
  variableNames: string[],
  variables: Record<string, string>
) {
  return variableNames.filter((name) => {
    if (builtInVariables.has(name)) return false;
    return (variables[name] ?? "").trim().length === 0;
  });
}

export function previewTemplateVariables(
  variableNames: string[],
  variables: Record<string, string>
) {
  const preview = { ...variables };
  for (const name of missingTemplateVariables(variableNames, variables)) {
    preview[name] = `[Missing ${templateVariableLabel(name)}]`;
  }
  return preview;
}

export function hasUnresolvedTemplateTokens(...values: Array<string | null | undefined>) {
  return values.some((value) => /{{\s*[a-zA-Z][a-zA-Z0-9_]{0,63}\s*}}/.test(value ?? ""));
}

export function defaultSubjectForTemplate(template: Pick<MailTemplateDetail, "name" | "subjectTemplate">) {
  if (template.subjectTemplate?.trim()) return null;
  if (/beta access ready/i.test(template.name)) {
    return "Your Vayvyx Private Beta Access Is Ready";
  }
  return null;
}

function parseRecipientHint(value: string) {
  const firstRecipient = value
    .split(/[;,]/)
    .map((item) => item.trim())
    .find(Boolean);

  if (!firstRecipient) return { firstName: "", email: "" };

  const namedAddress = firstRecipient.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (namedAddress) {
    return {
      firstName: firstToken(namedAddress[1]),
      email: normalizeEmail(namedAddress[2]),
    };
  }

  const email = normalizeEmail(firstRecipient);
  return {
    firstName: "",
    email,
  };
}

function firstToken(value: string) {
  return value.trim().split(/\s+/)[0] ?? "";
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
