import { useEffect, useState } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { mailApi, MailApiRequestError } from "../lib/mailApi.ts";
import { supabase } from "../lib/supabaseClient.ts";

type AccountPageProps = {
  onNavigate: NavigateWithTransition;
};

type License = {
  id: string;
  license_key: string;
  status: string;
  plan: string;
  max_devices: number;
  expires_at: string | null;
  created_at: string;
};

type AccountState =
  | {
      status: "loading";
      email: "";
      license: null;
      message: "";
    }
  | {
      status: "signed-out";
      email: "";
      license: null;
      message: string;
    }
  | {
      status: "signed-in";
      email: string;
      license: License | null;
      message: string;
    };

function formatDate(value: string | null) {
  if (!value) return "No expiration";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatStatus(status: string | undefined) {
  if (!status) return "No license";

  return status
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function AccountPage({ onNavigate }: AccountPageProps) {
  const [downloadMessage, setDownloadMessage] = useState("");
  const [mailActions, setMailActions] = useState({
    canOpenMail: false,
    canManageMail: false,
  });
  const [accountState, setAccountState] = useState<AccountState>({
    status: "loading",
    email: "",
    license: null,
    message: "",
  });

  useEffect(() => {
    async function loadAccount() {
      if (!supabase) {
        setAccountState({
          status: "signed-out",
          email: "",
          license: null,
          message:
            "Supabase is not connected. Check your .env.local configuration.",
        });
        return;
      }

      const sessionResponse = await supabase.auth.getSession();
      const session = sessionResponse.data.session;

      if (!session?.user) {
        setAccountState({
          status: "signed-out",
          email: "",
          license: null,
          message: "You are not logged in.",
        });
        return;
      }

      const user = session.user;

      try {
        const mailAccess = await mailApi.getAccess();
        setMailActions({
          canOpenMail: mailAccess.hasMailAccess,
          canManageMail: mailAccess.platformAdmin,
        });
      } catch (mailError) {
        if (
          mailError instanceof MailApiRequestError &&
          mailError.code === "AUTH_REQUIRED"
        ) {
          setMailActions({ canOpenMail: false, canManageMail: false });
        }
      }

      const { data: license, error } = await supabase
        .from("licenses")
        .select(
          "id, license_key, status, plan, max_devices, expires_at, created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setAccountState({
          status: "signed-in",
          email: user.email ?? "Unknown email",
          license: null,
          message: error.message,
        });
        return;
      }

      setAccountState({
        status: "signed-in",
        email: user.email ?? "Unknown email",
        license,
        message: license
          ? ""
          : "No license has been assigned to this account yet.",
      });
    }

    loadAccount();
  }, []);

  async function handleLogout() {
    if (!supabase) return;

    await supabase.auth.signOut();
    onNavigate("/");
  }

  function handleDownloadClick() {
    setDownloadMessage(
      "Download coming soon. Your account is ready, but the Vayvyx desktop installer has not been published yet."
    );
  }

  const license = accountState.license;
  const isActive = license?.status === "active";

  return (
    <main className="simple-page account-screen">
      <button className="back-button" onClick={() => onNavigate("/")}>
        ← Home
      </button>

      <section className="account-card">
        <div className="account-card-header">
          <div className="card-logo">
            <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
          </div>

          <div>
            <p className="eyebrow">Vayvyx account</p>
            <h1>Account</h1>
          </div>
        </div>

        {accountState.status === "loading" && (
          <p className="account-muted">Loading your account...</p>
        )}

        {accountState.status === "signed-out" && (
          <div className="account-stack">
            <p className="account-muted">{accountState.message}</p>

            <button
              className="account-primary-button"
              onClick={() => onNavigate("/login")}
            >
              Go to login
            </button>
          </div>
        )}

        {accountState.status === "signed-in" && (
          <div className="account-stack">
            <div className="account-section">
              <span className="account-label">Signed in as</span>
              <strong className="account-value">{accountState.email}</strong>
            </div>

            <div className="license-panel">
              <div className="license-panel-top">
                <div>
                  <span className="account-label">License status</span>
                  <strong className="license-status">
                    {formatStatus(license?.status)}
                  </strong>
                </div>

                <span
                  className={
                    isActive ? "status-pill active" : "status-pill inactive"
                  }
                >
                  {isActive ? "Active" : "Needs access"}
                </span>
              </div>

              <div className="license-grid">
                <div>
                  <span className="account-label">Plan</span>
                  <strong className="account-value">
                    {license?.plan ?? "Not assigned"}
                  </strong>
                </div>

                <div>
                  <span className="account-label">Devices</span>
                  <strong className="account-value">
                    {license ? `${license.max_devices} allowed` : "Not assigned"}
                  </strong>
                </div>

                <div>
                  <span className="account-label">Expires</span>
                  <strong className="account-value">
                    {license ? formatDate(license.expires_at) : "Not assigned"}
                  </strong>
                </div>

                <div>
                  <span className="account-label">License key</span>
                  <strong className="account-value license-key">
                    {license?.license_key ?? "Not assigned"}
                  </strong>
                </div>
              </div>

              {accountState.message && (
                <p className="form-message">{accountState.message}</p>
              )}

              {downloadMessage && (
                <p className="form-message">{downloadMessage}</p>
              )}
            </div>

            <div className="account-actions">
              {mailActions.canOpenMail && (
                <button
                  className="account-primary-button"
                  type="button"
                  onClick={() => onNavigate("/mail")}
                >
                  Open Vayvyx Mail
                </button>
              )}

              {mailActions.canManageMail && (
                <button
                  className="account-secondary-button"
                  type="button"
                  onClick={() => onNavigate("/admin/mail/settings")}
                >
                  Manage company mail
                </button>
              )}

              <button
                className="account-primary-button"
                type="button"
                disabled={!isActive}
                onClick={handleDownloadClick}
              >
                Download Vayvyx
              </button>

              <button
                className="account-secondary-button"
                type="button"
                onClick={handleLogout}
              >
                Log out
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
