export const mailNavigationCollapsedStorageKey = "vayvyx-mail-navigation-collapsed";

export function readMailNavigationCollapsedPreference(storage = getLocalStorage()): boolean {
  try {
    const storedValue = storage?.getItem(mailNavigationCollapsedStorageKey);
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
    return false;
  } catch {
    return false;
  }
}

export function writeMailNavigationCollapsedPreference(
  isMailNavigationCollapsed: boolean,
  storage = getLocalStorage()
) {
  try {
    storage?.setItem(
      mailNavigationCollapsedStorageKey,
      isMailNavigationCollapsed ? "true" : "false"
    );
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function getLocalStorage() {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
