import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { EditorHeader } from "@/components/EditorHeader";
import { UploadStage } from "@/components/UploadStage";
import { CaptionStudio } from "@/components/CaptionStudio";
import { PaywallDialog } from "@/components/PaywallDialog";

export const EditorPage = ({ user, onLogout }) => {
  const [usage, setUsage] = useState(null);
  const [project, setProject] = useState(null);
  const [pricing, setPricing] = useState(false);
  const loadUsage = () => api.get("/usage").then(({ data }) => setUsage(data));
  useEffect(() => { loadUsage(); }, []);
  const created = (next) => { setProject(next); loadUsage(); };
  return (
    <div className="editor-app" data-testid="captain-title-editor-app">
      <EditorHeader user={user} usage={usage} onPricing={() => setPricing(true)} onLogout={onLogout} />
      {project ? <CaptionStudio initialProject={project} onNew={() => setProject(null)} /> : <UploadStage onCreated={created} onPaywall={() => setPricing(true)} />}
      <PaywallDialog open={pricing} onOpenChange={setPricing} usage={usage} />
    </div>
  );
};