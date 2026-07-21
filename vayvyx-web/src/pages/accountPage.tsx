import { useEffect, useMemo, useState } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { supabase } from "../lib/supabaseClient.ts";
import "../styles/accountPage.css";

type AccountPageProps = {
  onNavigate: NavigateWithTransition;
};

type LicenseRecord = {
  id: string;
  license_key: string;
  status: string;
  plan: string | null;
  max_devices: number | null;
  expires_at: string | null;
  created_at: string;
};

type ProfileRecord = {
  full_name: string | null;
};

type AccountStatus = "active" | "pending" | "inactive" | "expired";
type CopyStatus = "idle" | "copied" | "error";

function capitalize(value: string | null | undefined) {
  if (!value) {
    return "Not assigned";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatExpiration(expiresAt: string | null | undefined) {
  if (!expiresAt) {
    return "No expiration";
  }

  const date = new Date(expiresAt);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function resolveLicenseStatus(
  license: LicenseRecord | null,
): AccountStatus {
  if (!license) {
    return "pending";
  }

  if (
    license.expires_at &&
    new Date(license.expires_at).getTime() < Date.now()
  ) {
    return "expired";
  }

  const normalizedStatus = license.status.toLowerCase();

  if (normalizedStatus === "active") {
    return "active";
  }

  if (normalizedStatus === "pending") {
    return "pending";
  }

  return "inactive";
}

function getStatusLabel(status: AccountStatus) {
  switch (status) {
    case "active":
      return "Active";
    case "pending":
      return "Pending approval";
    case "expired":
      return "Expired";
    default:
      return "Inactive";
  }
}

function maskLicenseKey(licenseKey: string) {
  if (licenseKey.length <= 8) {
    return "••••••••";
  }

  const firstSeparator = licenseKey.indexOf("-");
  const visiblePrefix =
    firstSeparator >= 0
      ? licenseKey.slice(0, firstSeparator + 1)
      : licenseKey.slice(0, 3);

  const visibleSuffix = licenseKey.slice(-4);

  return `${visiblePrefix}••••••••${visibleSuffix}`;
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");

  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");

  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("The browser could not copy the license key.");
  }
}

export function AccountPage({ onNavigate }: AccountPageProps) {
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [license, setLicense] = useState<LicenseRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isLicenseKeyVisible, setIsLicenseKeyVisible] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [pageError, setPageError] = useState("");

  const installerUrl =
    import.meta.env.VITE_VAYVYX_INSTALLER_URL?.trim() ?? "";

  useEffect(() => {
    let isMounted = true;

    async function loadAccount() {
      setIsLoading(true);
      setPageError("");

      try {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        const session = sessionData.session;

        if (!session) {
          onNavigate("/login");
          return;
        }

        if (!isMounted) {
          return;
        }

        const email = session.user.email ?? "Email unavailable";
        const metadataName = session.user.user_metadata?.full_name;

        setUserEmail(email);

        if (typeof metadataName === "string" && metadataName.trim()) {
          setUserName(metadataName.trim());
        }

        const [profileResult, licenseResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("full_name")
            .eq("id", session.user.id)
            .maybeSingle<ProfileRecord>(),

          supabase
            .from("licenses")
            .select(
              "id, license_key, status, plan, max_devices, expires_at, created_at",
            )
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<LicenseRecord>(),
        ]);

        if (licenseResult.error) {
          throw licenseResult.error;
        }

        if (!isMounted) {
          return;
        }

        const profileName = profileResult.data?.full_name?.trim();

        if (profileName) {
          setUserName(profileName);
        }

        setLicense(licenseResult.data);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setPageError(
          error instanceof Error
            ? error.message
            : "Vayvyx could not load your account.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAccount();

    return () => {
      isMounted = false;
    };
  }, [onNavigate]);

  const licenseStatus = useMemo(
    () => resolveLicenseStatus(license),
    [license],
  );

  const displayName = useMemo(() => {
    if (userName.trim()) {
      return userName.trim();
    }

    if (userEmail.includes("@")) {
      return userEmail.split("@")[0];
    }

    return "Vayvyx user";
  }, [userEmail, userName]);

  const greetingName = useMemo(() => {
    const firstName = displayName.split(/\s+/)[0];
    return firstName || "Vayvyx user";
  }, [displayName]);

  const installerAvailable =
    Boolean(installerUrl) && licenseStatus === "active";

  async function handleSignOut() {
    setIsSigningOut(true);
    setPageError("");

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      onNavigate("/");
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "Vayvyx could not log you out.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleCopyLicenseKey() {
    if (!license?.license_key) {
      return;
    }

    setCopyStatus("idle");

    try {
      await copyTextToClipboard(license.license_key);
      setCopyStatus("copied");

      window.setTimeout(() => {
        setCopyStatus("idle");
      }, 1800);
    } catch {
      setCopyStatus("error");

      window.setTimeout(() => {
        setCopyStatus("idle");
      }, 2500);
    }
  }

  function handleInstallerDownload() {
    if (!installerAvailable) {
      return;
    }

    window.location.assign(installerUrl);
  }

  if (isLoading) {
    return (
      <main className="account-portal-page">
        <div className="account-loading-panel">
          <img src="/vayvyx-logo.png" alt="Vayvyx logo" />

          <p className="account-portal-eyebrow">Vayvyx account</p>

          <h1>Loading your access...</h1>

          <div className="account-loading-bar" aria-hidden="true">
            <span />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="account-portal-page">
      <header className="account-portal-navigation">
        <button
          className="account-navigation-button"
          type="button"
          onClick={() => onNavigate("/")}
        >
          <span aria-hidden="true">←</span>
          Home
        </button>

        <button
          className="account-navigation-button account-logout-top"
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
        >
          {isSigningOut ? "Logging out..." : "Log out"}
        </button>
      </header>

      <div className="account-portal-shell">
        <aside className="account-portal-information">
          <div className="account-portal-brand">
            <div className="account-portal-logo">
              <img src="/vayvyx-logo.png" alt="" />
            </div>

            <span>Vayvyx</span>
          </div>

          <div className="account-portal-information-content">
            <p className="account-portal-eyebrow">Private beta account</p>

            <h1>Your Vayvyx access, in one place.</h1>

            <p className="account-portal-description">
              Review your account, product license, device allowance, and beta
              download availability from one controlled portal.
            </p>

            <div className="account-portal-feature-list">
              <div className="account-portal-feature">
                <span>01</span>

                <div>
                  <strong>Account identity</strong>
                  <p>
                    Your authenticated account determines which license records
                    you can access.
                  </p>
                </div>
              </div>

              <div className="account-portal-feature">
                <span>02</span>

                <div>
                  <strong>License status</strong>
                  <p>
                    Product access is controlled separately from basic account
                    registration.
                  </p>
                </div>
              </div>

              <div className="account-portal-feature">
                <span>03</span>

                <div>
                  <strong>Desktop availability</strong>
                  <p>
                    Approved users will receive access when the beta installer
                    is published.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="account-portal-panel-footer">
            <span>Controlled access</span>
            <span>Private beta</span>
          </div>
        </aside>

        <section className="account-dashboard">
          <div className="account-dashboard-header">
            <div>
              <p className="account-portal-eyebrow">Account dashboard</p>

              <h2>Welcome, {greetingName}.</h2>

              <p>
                Your current Vayvyx account and licensing information is shown
                below.
              </p>
            </div>

            <span
              className={`account-status-pill account-status-${licenseStatus}`}
            >
              <span aria-hidden="true" />
              {getStatusLabel(licenseStatus)}
            </span>
          </div>

          {pageError && (
            <div
              className="account-portal-message account-portal-message-error"
              role="alert"
            >
              {pageError}
            </div>
          )}

          <section className="account-dashboard-section">
            <div className="account-section-heading">
              <div>
                <span className="account-section-number">01</span>

                <div>
                  <h3>Account</h3>
                  <p>Your authenticated Vayvyx identity.</p>
                </div>
              </div>
            </div>

            <div className="account-identity-row">
              <div className="account-avatar" aria-hidden="true">
                {displayName.charAt(0).toUpperCase()}
              </div>

              <div className="account-identity-details">
                <strong>{displayName}</strong>
                <span>{userEmail}</span>
              </div>

              <span className="account-verified-label">Authenticated</span>
            </div>
          </section>

          <section className="account-dashboard-section">
            <div className="account-section-heading">
              <div>
                <span className="account-section-number">02</span>

                <div>
                  <h3>Product license</h3>
                  <p>Your current desktop application access.</p>
                </div>
              </div>

              <span
                className={`account-license-label account-license-${licenseStatus}`}
              >
                {getStatusLabel(licenseStatus)}
              </span>
            </div>

            {license ? (
              <div className="account-license-grid">
                <div className="account-license-item">
                  <span>Plan</span>
                  <strong>{capitalize(license.plan)}</strong>
                </div>

                <div className="account-license-item">
                  <span>Devices allowed</span>
                  <strong>
                    {license.max_devices ?? 0}{" "}
                    {license.max_devices === 1 ? "device" : "devices"}
                  </strong>
                </div>

                <div className="account-license-item">
                  <span>Expiration</span>
                  <strong>{formatExpiration(license.expires_at)}</strong>
                </div>

                <div className="account-license-item account-license-key-item">
                  <span>License key</span>

                  <div className="account-license-key-row">
                    <strong>
                      {isLicenseKeyVisible
                        ? license.license_key
                        : maskLicenseKey(license.license_key)}
                    </strong>

                    <div className="account-license-key-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setIsLicenseKeyVisible((current) => !current)
                        }
                        aria-label={
                          isLicenseKeyVisible
                            ? "Hide license key"
                            : "Reveal license key"
                        }
                      >
                        {isLicenseKeyVisible ? "Hide" : "Reveal"}
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyLicenseKey}
                      >
                        {copyStatus === "copied"
                          ? "Copied"
                          : copyStatus === "error"
                            ? "Copy failed"
                            : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="account-empty-license">
                <strong>No license assigned yet</strong>

                <p>
                  Your account exists, but a Vayvyx beta license has not been
                  assigned to it.
                </p>
              </div>
            )}
          </section>

          <section className="account-download-panel">
            <div className="account-download-icon" aria-hidden="true">
              ↓
            </div>

            <div className="account-download-content">
              <p className="account-portal-eyebrow">Desktop application</p>

              <h3>Vayvyx beta download</h3>

              <p>
                {installerAvailable
                  ? "A Vayvyx desktop beta build is available for your approved account."
                  : "The desktop installer is not publicly available yet. Approved accounts will use this portal to access future beta builds."}
              </p>
            </div>

            <button
              className="account-download-button"
              type="button"
              onClick={handleInstallerDownload}
              disabled={!installerAvailable}
            >
              {installerAvailable
                ? "Download for Windows"
                : "Beta installer coming soon"}
            </button>
          </section>

          <footer className="account-dashboard-footer">
            <p>
              License keys identify product access. They do not contain project
              documents, uploaded files, or project data.
            </p>

            <span>Account and licensing data only</span>
          </footer>
        </section>
      </div>

      <footer className="account-portal-page-footer">
        <span>© 2026 Vayvyx</span>
        <span>Private beta account portal</span>
      </footer>
    </main>
  );
}