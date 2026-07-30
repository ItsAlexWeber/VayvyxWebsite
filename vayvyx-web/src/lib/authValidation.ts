export const passwordMinimumLength = 8;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAuthEmail(value: string) {
  return value.trim().toLowerCase();
}

export function resemblesEmailAddress(value: string) {
  return emailPattern.test(value);
}

export function getPasswordPolicyHint() {
  return `Use at least ${passwordMinimumLength} characters.`;
}

export function validateNewPasswordPair(
  newPassword: string,
  confirmPassword: string,
) {
  if (!newPassword || !confirmPassword) {
    return "Enter and confirm your new password.";
  }

  if (
    newPassword.trim() !== newPassword ||
    confirmPassword.trim() !== confirmPassword
  ) {
    return "Passwords cannot start or end with a space.";
  }

  if (newPassword.length < passwordMinimumLength) {
    return "Your password must contain at least eight characters.";
  }

  if (newPassword !== confirmPassword) {
    return "Passwords must match.";
  }

  return null;
}
