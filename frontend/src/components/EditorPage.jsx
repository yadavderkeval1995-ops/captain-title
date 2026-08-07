import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { EditorHeader } from "@/components/EditorHeader";
import { UploadStage } from "@/components/UploadStage";
import { CaptionStudio } from "@/components/CaptionStudio";
import { PaywallDialog } from "@/components/PaywallDialog";

export const EditorPage = ({ user, onLogout }) => {
  const [usage, setUsage] = useState(null);
  const [project, setProject] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [pricing, setPricing] = useState(false);
  const loadUsage = () => api.get("/usage").then(({ data }) => setUsage(data));
  const loadProjects = () => api.get("/projects").then(({ data }) => setRecentProjects(data));
  useEffect(() => { loadUsage(); loadProjects(); }, []);
  const created = (next) => { setProject(next); loadUsage(); loadProjects(); };
  const openProject = async (projectId) => { const { data } = await api.get(`/projects/${projectId}`); setProject(data); };
  return (
    <div className="editor-app" data-testid="captain-title-editor-app">
      <EditorHeader user={user} usage={usage} onPricing={() => setPricing(true)} onLogout={onLogout} />
      {project ? <CaptionStudio initialProject={project} onNew={() => { setProject(null); loadProjects(); }} /> : <UploadStage onCreated={created} onPaywall={() => setPricing(true)} recentProjects={recentProjects} onOpenProject={openProject} />}
      <PaywallDialog open={pricing} onOpenChange={setPricing} usage={usage} />
    </div>
  );
};