import { useEffect, useState } from "react";
import { CheckCircle, XCircle } from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export const PaymentResult = ({ success = false }) => {
  const [params] = useSearchParams(); const navigate = useNavigate();
  const [status, setStatus] = useState(success ? "confirming" : "cancelled");
  useEffect(() => {
    if (!success) return;
    const session = params.get("session_id");
    if (!session) return setStatus("missing");
    const timer = setInterval(() => api.get(`/payments/status/${session}`).then(({ data }) => {
      if (data.payment_status === "paid") { setStatus("paid"); clearInterval(timer); }
    }).catch(() => setStatus("error")), 2000);
    return () => clearInterval(timer);
  }, [params, success]);
  return <main className="payment-result" data-testid="payment-result-page">
    {status === "paid" ? <CheckCircle size={52} weight="fill" /> : <XCircle size={52} />}
    <h1 data-testid="payment-result-title">{status === "paid" ? "Credits unlocked" : status === "confirming" ? "Confirming payment…" : "Payment not completed"}</h1>
    <p data-testid="payment-result-description">{status === "paid" ? "Your creator credits are ready in the studio." : "No credits were charged. You can return to your caption session."}</p>
    <Button onClick={() => navigate("/editor")} data-testid="return-to-editor-button">Return to editor</Button>
  </main>;
};