import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { HexTransition } from "./components/hexTransition.tsx";
import { InteractiveBackground } from "./components/interactiveBackground.tsx";
import { HomePage } from "./pages/homePage.tsx";
import { LoginPage } from "./pages/loginPage.tsx";
import { ForgotPasswordPage } from "./pages/forgotPasswordPage.tsx";
import { ResetPasswordPage } from "./pages/resetPasswordPage.tsx";
import { RequestDemoPage } from "./pages/requestDemoPage.tsx";
import { AccountPage } from "./pages/accountPage.tsx";
import { MailPage } from "./pages/mailPage.tsx";
import { MailAdminSettingsPage } from "./pages/mailAdminSettingsPage.tsx";

export type NavigateWithTransition = (path: string) => void;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isTransitioning, setIsTransitioning] = useState(false);

  const navigateTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);

  const navigateWithTransition = useCallback(
    (path: string) => {
      if (isTransitioning || path === location.pathname) return;

      if (navigateTimerRef.current) {
        window.clearTimeout(navigateTimerRef.current);
      }

      if (endTimerRef.current) {
        window.clearTimeout(endTimerRef.current);
      }

      setIsTransitioning(true);

      navigateTimerRef.current = window.setTimeout(() => {
        navigate(path);
      }, 1450);

      endTimerRef.current = window.setTimeout(() => {
        setIsTransitioning(false);
      }, 2350);
    },
    [isTransitioning, location.pathname, navigate]
  );

  useEffect(() => {
    return () => {
      if (navigateTimerRef.current) {
        window.clearTimeout(navigateTimerRef.current);
      }

      if (endTimerRef.current) {
        window.clearTimeout(endTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      <InteractiveBackground />

      <div className="app-content">
        <Routes>
          <Route
            path="/"
            element={<HomePage onNavigate={navigateWithTransition} />}
          />

          <Route
            path="/login"
            element={<LoginPage onNavigate={navigateWithTransition} />}
          />

          <Route
            path="/forgot-password"
            element={<ForgotPasswordPage onNavigate={navigateWithTransition} />}
          />

          <Route
            path="/reset-password"
            element={<ResetPasswordPage onNavigate={navigateWithTransition} />}
          />

          <Route
            path="/request-demo"
            element={<RequestDemoPage onNavigate={navigateWithTransition} />}
          />

          <Route
            path="/account"
            element={<AccountPage onNavigate={navigateWithTransition} />}
          />

          <Route
            path="/mail"
            element={<MailPage onNavigate={navigateWithTransition} />}
          />

          <Route
            path="/admin/mail/settings"
            element={
              <MailAdminSettingsPage onNavigate={navigateWithTransition} />
            }
          />
        </Routes>
      </div>

      <HexTransition isActive={isTransitioning} />
    </>
  );
}
