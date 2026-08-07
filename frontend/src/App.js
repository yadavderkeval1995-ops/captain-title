import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { AuthScreen } from "@/components/AuthScreen";
import { EditorPage } from "@/components/EditorPage";
import { PaymentResult } from "@/components/PaymentResult";
import "@/App.css";

function AuthCallback({ onAuth }) {
  const location = useLocation();
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const sessionId = new URLSearchParams(location.hash.replace("#", "")).get("session_id");
    if (!sessionId) return navigate("/", { replace: true });
    api.post("/auth/google/session", { session_id: sessionId }).then(({ data }) => {
      window.history.replaceState({}, "", "/editor");
      onAuth(data);
      navigate("/editor", { replace: true });
    }).catch(() => navigate("/", { replace: true }));
  }, [location.hash, navigate, onAuth]);
  return <div className="auth-loading" data-testid="google-auth-processing-status">Connecting your creator account…</div>;
}

function AppRouter() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  const setAuthenticatedUser = useCallback((profile) => {
    setUser(profile);
    setChecking(false);
  }, []);

  useEffect(() => {
    if (window.location.hash.includes("session_id=")) {
      setChecking(false);
      return;
    }
    api.get("/auth/me").then(({ data }) => setUser(data)).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  if (location.hash?.includes("session_id=")) return <AuthCallback onAuth={setAuthenticatedUser} />;
  if (checking) return <div className="auth-loading" data-testid="auth-checking-status">Loading Captain Title…</div>;

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/editor" replace /> : <AuthScreen onAuth={setAuthenticatedUser} />} />
      <Route path="/editor" element={user ? <EditorPage user={user} onLogout={() => setUser(null)} /> : <Navigate to="/" replace />} />
      <Route path="/payment/success" element={user ? <PaymentResult success /> : <Navigate to="/" replace />} />
      <Route path="/payment/cancel" element={user ? <PaymentResult /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to={user ? "/editor" : "/"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRouter />
      <Toaster theme="dark" position="top-center" />
    </BrowserRouter>
  );
}