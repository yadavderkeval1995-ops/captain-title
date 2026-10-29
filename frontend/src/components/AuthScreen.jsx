import { useEffect, useState } from "react";
import { ArrowRight, ClosedCaptioning, GoogleLogo, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, API_ROOT, errorMessage } from "@/lib/api";

const GOOGLE_ERROR_MESSAGES = {
  not_configured: "Google sign-in isn't set up on this server yet. Use email/password, or ask the admin to add GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.",
  denied: "Google sign-in was cancelled.",
  failed: "Google sign-in failed. Please try again or use email/password.",
};

export const AuthScreen = ({ onAuth }) => {
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("google_error");
    if (error) {
      toast.error(GOOGLE_ERROR_MESSAGES[error] || "Google sign-in failed.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = mode === "login" ? { email: form.email, password: form.password } : form;
      const { data } = await api.post(`/auth/${mode}`, payload);
      onAuth(data);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = () => {
    window.location.href = `${API_ROOT}/auth/google/login`;
  };

  return (
    <main className="auth-page" data-testid="authentication-page">
      <section className="auth-brand" data-testid="captain-title-brand-panel">
        <div className="brand-lockup"><span className="brand-mark"><ClosedCaptioning size={26} weight="fill" /></span> TADAAAM</div>
        <div className="brand-copy">
          <p className="eyebrow" data-testid="brand-eyebrow"><Sparkle size={16} /> WORDS THAT HIT ON BEAT</p>
          <h1 data-testid="brand-heading">Turn every spoken word into a visual hook.</h1>
          <p data-testid="brand-description">Word-perfect Hinglish captions, mixed typography, and creator-ready video exports.</p>
        </div>
        <div className="caption-demo" data-testid="caption-style-preview"><span>Har</span> <strong>WORD</strong> <em>matters.</em></div>
      </section>
      <section className="auth-form-wrap" data-testid="authentication-form-panel">
        <div className="auth-form-head">
          <p className="eyebrow" data-testid="auth-welcome-label">CREATOR ACCESS</p>
          <h2 data-testid="auth-form-title">{mode === "login" ? "Welcome back" : "Create your studio"}</h2>
          <p data-testid="free-trial-summary">Your first 45-second captioned video is free.</p>
        </div>
        <Button className="google-button" variant="outline" onClick={googleLogin} data-testid="google-login-button">
          <GoogleLogo size={20} weight="bold" /> Continue with Google
        </Button>
        <div className="auth-divider" data-testid="authentication-divider"><span>OR USE EMAIL</span></div>
        <form onSubmit={submit} className="auth-form" data-testid="email-authentication-form">
          {mode === "register" && <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Creator name" required data-testid="registration-name-input" />}
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email address" required data-testid="authentication-email-input" />
          <Input type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password · 8+ characters" required data-testid="authentication-password-input" />
          <Button type="submit" disabled={loading} data-testid="email-authentication-submit-button">
            {loading ? "Please wait…" : mode === "login" ? "Enter studio" : "Start creating"} <ArrowRight size={18} />
          </Button>
        </form>
        <button className="mode-switch" onClick={() => setMode(mode === "login" ? "register" : "login")} data-testid="authentication-mode-switch-button">
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
};