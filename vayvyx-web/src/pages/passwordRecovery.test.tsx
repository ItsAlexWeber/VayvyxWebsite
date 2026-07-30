/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../app.tsx";
import { AccountPage } from "./accountPage.tsx";
import { ForgotPasswordPage } from "./forgotPasswordPage.tsx";
import { LoginPage } from "./loginPage.tsx";
import { ResetPasswordPage } from "./resetPasswordPage.tsx";

type AuthStateCallback = (event: string, session: Session | null) => void;

const supabaseMocks = vi.hoisted(() => ({
  auth: {
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
  from: vi.fn(),
}));

const mailApiMock = vi.hoisted(() => ({
  getAccess: vi.fn(),
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabaseClient.ts", () => ({
  supabase: {
    auth: supabaseMocks.auth,
    from: supabaseMocks.from,
  },
}));

vi.mock("../lib/mailApi.ts", () => ({
  mailApi: mailApiMock,
  MailApiRequestError: class MailApiRequestError extends Error {
    code: string;

    constructor(message = "Mail API error", code = "MAIL_ERROR") {
      super(message);
      this.code = code;
    }
  },
}));

const genericResetMessage =
  "If an account exists for that email address, a password reset link has been sent.";
const invalidRecoveryMessage =
  "This password-reset link is invalid or has expired.";

const recoverySession = {
  user: {
    id: "user-1",
    email: "alex@example.com",
  },
} as Session;

let authCallback: AuthStateCallback | null = null;
let unsubscribeMock = vi.fn();

beforeEach(() => {
  authCallback = null;
  unsubscribeMock = vi.fn();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  supabaseMocks.auth.resetPasswordForEmail.mockResolvedValue({
    data: {},
    error: null,
  });
  supabaseMocks.auth.updateUser.mockResolvedValue({
    data: { user: recoverySession.user },
    error: null,
  });
  supabaseMocks.auth.signOut.mockResolvedValue({ error: null });
  supabaseMocks.auth.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  supabaseMocks.auth.onAuthStateChange.mockImplementation(
    (callback: AuthStateCallback) => {
      authCallback = callback;

      return {
        data: {
          subscription: {
            unsubscribe: unsubscribeMock,
          },
        },
      };
    },
  );
  supabaseMocks.from.mockReturnValue(createLicenseQuery());
  mailApiMock.getAccess.mockResolvedValue({
    authenticated: true,
    platformAdmin: false,
    hasMailAccess: false,
    mailboxCount: 0,
  });
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("password recovery and change pages", () => {
  it("shows the forgot-password link on the login page", () => {
    render(<LoginPage onNavigate={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Forgot password?" }).getAttribute("href"),
    ).toBe("/forgot-password");
  });

  it("keeps the forgot-password route public", () => {
    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(screen.queryByText("Go to login")).toBeNull();
  });

  it("trims email and sends the correct reset redirect URL", async () => {
    render(<ForgotPasswordPage onNavigate={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "  ALEX@EXAMPLE.COM  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/forgot-password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "alex@example.com" }),
        }),
      ),
    );
    expect(supabaseMocks.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(screen.getByText(genericResetMessage)).toBeTruthy();
    expect(document.body.textContent).not.toContain("No account");
    expect(document.body.textContent).not.toContain("registered account");
  });

  it("blocks duplicate forgot-password submissions while pending", async () => {
    let resolveReset!: (value: Response) => void;
    const resetPromise = new Promise<Response>((resolve) => {
      resolveReset = resolve;
    });
    fetchMock.mockReturnValue(resetPromise);
    const { container } = render(<ForgotPasswordPage onNavigate={vi.fn()} />);
    const form = container.querySelector("form");

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveReset(new Response("{}", { status: 200 }));
    await screen.findByText(genericResetMessage);
  });

  it("uses safe failure text and never renders raw forgot-password errors", async () => {
    fetchMock.mockResolvedValue(new Response("raw access_token=secret recovery_url=https://secret", { status: 500 }));
    render(<ForgotPasswordPage onNavigate={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText(
        "Password reset is temporarily unavailable. Try again shortly.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("access_token");
    expect(document.body.textContent).not.toContain("recovery_url");
  });

  it("accepts the PASSWORD_RECOVERY auth event", async () => {
    render(<ResetPasswordPage onNavigate={vi.fn()} />);

    authCallback?.("PASSWORD_RECOVERY", recoverySession);

    expect(await screen.findByLabelText("New password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update password" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("detects an existing recovery session after initialization", async () => {
    supabaseMocks.auth.getSession.mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });

    render(<ResetPasswordPage onNavigate={vi.fn()} />);

    expect(await screen.findByLabelText("New password")).toBeTruthy();
  });

  it("shows a safe invalid-link state when the recovery session is missing", async () => {
    render(<ResetPasswordPage onNavigate={vi.fn()} />);

    expect(await screen.findByText(invalidRecoveryMessage)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request another reset link" })).toBeTruthy();
  });

  it("shows a safe invalid-link state for expired recovery links", async () => {
    window.history.pushState(
      {},
      "",
      "/reset-password#error_code=otp_expired&type=recovery",
    );

    render(<ResetPasswordPage onNavigate={vi.fn()} />);

    expect(await screen.findByText(invalidRecoveryMessage)).toBeTruthy();
    expect(document.body.textContent).not.toContain("otp_expired");
  });

  it("requires matching passwords and enforces the password rules", async () => {
    supabaseMocks.auth.getSession.mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    render(<ResetPasswordPage onNavigate={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("New password"), {
      target: { value: "validpass" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(screen.getByText("Passwords must match.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(
      screen.getByText("Your password must contain at least eight characters."),
    ).toBeTruthy();
    expect(supabaseMocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates the password, signs out, and routes to login after success", async () => {
    supabaseMocks.auth.getSession.mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    const onNavigate = vi.fn();
    render(<ResetPasswordPage onNavigate={onNavigate} />);

    fireEvent.change(await screen.findByLabelText("New password"), {
      target: { value: "new-secure-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "new-secure-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(supabaseMocks.auth.updateUser).toHaveBeenCalledWith({
        password: "new-secure-password",
      }),
    );
    expect(await screen.findByText("Your password was changed. You may sign in with the new password.")).toBeTruthy();
    await waitFor(() => expect(supabaseMocks.auth.signOut).toHaveBeenCalled());
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/login"), {
      timeout: 2_000,
    });
  });

  it("never renders raw reset errors, tokens, or Supabase internals", async () => {
    supabaseMocks.auth.getSession.mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    supabaseMocks.auth.updateUser.mockResolvedValue({
      data: {},
      error: new Error("supabase stack access_token=secret refresh_token=secret"),
    });
    render(<ResetPasswordPage onNavigate={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("New password"), {
      target: { value: "new-secure-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "new-secure-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password update is temporarily unavailable. Try again shortly.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("access_token");
    expect(document.body.textContent).not.toContain("refresh_token");
    expect(document.body.textContent).not.toContain("supabase stack");
  });

  it("cleans up recovery auth subscriptions on unmount", () => {
    const { unmount } = render(<ResetPasswordPage onNavigate={vi.fn()} />);

    unmount();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("requires authentication before account password change is shown", async () => {
    render(<AccountPage onNavigate={vi.fn()} />);

    expect(await screen.findByText("You are not logged in.")).toBeTruthy();
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("changes the account password for authenticated users", async () => {
    supabaseMocks.auth.getSession.mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });
    render(<AccountPage onNavigate={vi.fn()} />);

    expect(await screen.findByText("alex@example.com")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "account-new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "account-new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(supabaseMocks.auth.updateUser).toHaveBeenCalledWith({
        password: "account-new-password",
      }),
    );
    expect(await screen.findByText("Your password was updated.")).toBeTruthy();
  });

  it("keeps mobile-width recovery forms keyboard-submittable", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const { container } = render(<ForgotPasswordPage onNavigate={vi.fn()} />);
    const emailInput = screen.getByLabelText("Email address");
    const form = container.querySelector("form");

    fireEvent.change(emailInput, {
      target: { value: "mobile@example.com" },
    });
    fireEvent.keyDown(emailInput, { key: "Enter" });
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/forgot-password",
        expect.objectContaining({
          body: JSON.stringify({ email: "mobile@example.com" }),
        }),
      ),
    );
  });
});

function createLicenseQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: null,
      error: null,
    })),
  };

  return query;
}
