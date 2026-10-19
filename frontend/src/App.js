import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { AuthScreen } from "@/components/AuthScreen";
import { EditorPage } from "@/components/EditorPage";
import { PaymentResult } from "@/components/PaymentResult";
import "@/App.css";

function AppRouter() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  const setAuthenticatedUser = useCallback((profile) => {
    setUser(profile);
    setChecking(false);
  }, []);

  useEffect(() => {
    api.get("/auth/me").then(({ data }) => setUser(data)).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

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