import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { EditorHeader } from "@/components/EditorHeader";
import { UploadStage } from "@/components/UploadStage";
import { CaptionStudio } from "@/components/CaptionStudio";
import { SrtLocalization } from "@/components/SrtLocalization";
import { PaywallDialog } from "@/components/PaywallDialog";
import "@/workflow-switch.css";

export const EditorPage = ({ user, onLogout }) => {
  const [usage, setUsage] = useState(null);
  const [project, setProject] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [pricing, setPricing] = useState(false);
  const [mode, setMode] = useState("captions");
  const loadUsage = () => api.get("/usage").then(({ data }) => setUsage(data));
  const loadProjects = () => api.get("/projects").then(({ data }) => setRecentProjects(data));
  useEffect(() => { loadUsage(); loadProjects(); }, []);
  const created = (next) => { setProject(next); loadUsage(); loadProjects(); };
  const openProject = async (projectId) => { const { data } = await api.get(`/projects/${projectId}`); setProject(data); };
  return (
    <div className="editor-app" data-testid="captain-title-editor-app">
      <EditorHeader user={user} usage={usage} onPricing={() => setPricing(true)} onLogout={onLogout} />
      {!project && <nav className="workflow-switch" data-testid="workflow-switch"><button className={mode === "captions" ? "active" : ""} onClick={() => setMode("captions")}>Video captions</button><button className={mode === "srt" ? "active" : ""} onClick={() => setMode("srt")}>English SRT → Hindi SRT</button></nav>}
      {project ? <CaptionStudio initialProject={project} onNew={() => { setProject(null); loadProjects(); }} /> : mode === "srt" ? <SrtLocalization onBack={() => setMode("captions")} /> : <UploadStage onCreated={created} onPaywall={() => setPricing(true)} recentProjects={recentProjects} onOpenProject={openProject} />}
      <PaywallDialog open={pricing} onOpenChange={setPricing} usage={usage} />
    </div>
  );
};
