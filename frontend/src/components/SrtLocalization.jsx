import { useEffect, useRef, useState } from "react";
import { DownloadSimple, FilmStrip, Sparkle, UploadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API_ROOT, api, errorMessage } from "@/lib/api";
import "@/srt-localization.css";

const STYLE_ICONS = { "gen-z": "CHAT", cinematic: "FILM", "urdu-touch": "POETRY" };

export const SrtLocalization = ({ onBack }) => {
  const videoInput = useRef(null); const srtInput = useRef(null);
  const [video, setVideo] = useState(null); const [srt, setSrt] = useState(null); const [job, setJob] = useState(null);
  const [mode, setMode] = useState("fast");
  const [selectedStyle, setSelectedStyle] = useState(""); const [styleBrief, setStyleBrief] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job || ["awaiting_style", "completed", "failed"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try { setJob((await api.get(`/srt-projects/${job.job_id}`)).data); } catch {}
    }, 2200);
    return () => window.clearInterval(timer);
  }, [job]);

  const start = async () => {
    if (!srt || (mode === "video" && !video)) return toast.error(mode === "fast" ? "Choose an English SRT" : "Choose both the original video and English SRT");
    const form = new FormData(); if (mode === "video") form.append("video", video); form.append("english_srt", srt); setBusy(true);
    try { setJob((await api.post(mode === "fast" ? "/srt-projects/fast" : "/srt-projects", form, { headers: { "Content-Type": "multipart/form-data" } })).data); }
    catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); }
  };
  const approve = async () => {
    setBusy(true);
    try { await api.post(`/srt-projects/${job.job_id}/approve-style`, { style: selectedStyle, style_brief: styleBrief, project_guide: "Keep recurring character voice, names, terminology, relationship pronouns, and register consistent." }); setJob((await api.get(`/srt-projects/${job.job_id}`)).data); toast.success("Voice approved. Translating the full SRT."); }
    catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); }
  };
  const download = () => { window.location.href = `${API_ROOT}/srt-projects/${job.job_id}/download`; };

  return <main className="srt-localizer" data-testid="srt-localization-workspace">
    <section className="srt-hero"><button onClick={onBack}>← CAPTION STUDIO</button><p className="eyebrow"><Sparkle size={17} /> VIDEO-AWARE HINDI SRT</p><h1>English timing.<br /><span>Human Hindi emotion.</span></h1><p>Upload the original video and its English SRT. Captain Title reads the scene, auditions three Devanagari Hindi voices, then applies your approved direction to the complete subtitle file.</p></section>
    {!job && <><div className="srt-mode-switch"><button className={mode === "fast" ? "active" : ""} onClick={() => setMode("fast")}>Fast SRT only · Recommended</button><button className={mode === "video" ? "active" : ""} onClick={() => setMode("video")}>Video-aware · Slower</button></div><section className={`srt-upload-card ${mode === "fast" ? "fast" : ""}`}>
      {mode === "video" && <button className={video ? "selected" : ""} onClick={() => videoInput.current.click()}><FilmStrip size={34} /><strong>{video?.name || "Choose original video"}</strong><small>Optional slower visual-context workflow</small><input ref={videoInput} type="file" accept="video/*" hidden onChange={(event) => setVideo(event.target.files[0])} /></button>}
      <button className={srt ? "selected" : ""} onClick={() => srtInput.current.click()}><UploadSimple size={34} /><strong>{srt?.name || "Choose English SRT"}</strong><small>Valid UTF-8 SubRip file</small><input ref={srtInput} type="file" accept=".srt" hidden onChange={(event) => setSrt(event.target.files[0])} /></button>
      <Button onClick={start} disabled={busy || !srt || (mode === "video" && !video)}>{busy ? "Uploading…" : mode === "fast" ? "Audition Hindi styles" : "Analyze video & audition Hindi styles"}</Button>
    </section></>}
    {job && !["awaiting_style", "completed", "failed"].includes(job.status) && <section className="srt-progress"><span>{job.processing_label}</span><b>{job.progress}%</b><i><em style={{ width: `${job.progress}%` }} /></i><p>Speech meaning comes from the English SRT; video frames add soft emotional and visual context.</p></section>}
    {job?.warnings?.map((warning) => <div className="srt-warning" key={warning}>{warning}</div>)}
    {job?.status === "failed" && <section className="srt-failed"><h2>Localization paused</h2><p>{job.error_message}</p><Button onClick={() => setJob(null)}>Start again</Button></section>}
    {job?.status === "awaiting_style" && <section className="srt-audition">
      <header><p className="eyebrow">VOICE TEST / REVIEW</p><h2>How should this story sound?</h2><p>The same representative scene, adapted three ways. Select the closest direction and optionally describe a blend.</p></header>
      <div className="srt-source-lines">{job.sample_cues.map((cue) => <span key={cue.index}><small>{cue.index}</small>{cue.text}</span>)}</div>
      <div className="srt-style-grid">{job.style_samples.map((sample) => <button key={sample.style} className={selectedStyle === sample.style ? "active" : ""} onClick={() => setSelectedStyle(sample.style)}><span>{STYLE_ICONS[sample.style]}</span><h3>{sample.label}</h3><p>{sample.rationale}</p><div>{sample.translations.map((line) => <strong key={line.index}><small>{line.index}</small>{line.translated_text}</strong>)}</div></button>)}</div>
      <label><span>Optional blend or character note</span><textarea value={styleBrief} onChange={(event) => setStyleBrief(event.target.value)} maxLength={1000} placeholder="Example: cinematic overall, but keep the younger character's speech casual and modern." /></label>
      <Button onClick={approve} disabled={!selectedStyle || busy}>{busy ? "Approving…" : "Approve voice & translate full SRT"}</Button>
    </section>}
    {job?.status === "completed" && <section className="srt-complete"><DownloadSimple size={44} /><p className="eyebrow">HINDI SRT / READY</p><h2>Your scene-matched Devanagari subtitles are ready.</h2><p>Timestamps and cue order are preserved. Review the downloaded file against the video before publication.</p><Button onClick={download}><DownloadSimple size={18} /> Download Hindi SRT</Button><button onClick={() => setJob(null)}>Start another project</button></section>}
  </main>;
};
