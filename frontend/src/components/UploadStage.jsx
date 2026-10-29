import { useRef, useState } from "react";
import { FilmStrip, UploadSimple, Waveform } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

export const UploadStage = ({ onCreated, onPaywall }) => {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(null);
  const [probing, setProbing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingLabel, setProcessingLabel] = useState("");
  const [speechLanguage, setSpeechLanguage] = useState("auto");
  const [sttEngine, setSttEngine] = useState("sarvam");

  const inspect = (selected) => {
    if (!selected) return;
    if (!/\.(mp4|mov)$/i.test(selected.name)) return toast.error("Choose an MP4 or MOV video");
    setFile(selected);
    setDuration(null);
    setProbing(true);
    const video = document.createElement("video");
    const finishProbe = () => setProbing(false);
    const probeTimer = window.setTimeout(finishProbe, 2500);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      window.clearTimeout(probeTimer);
      finishProbe();
      if (video.duration > 120) return toast.error("Video must be 120 seconds or shorter");
      setDuration(video.duration);
    };
    video.onerror = () => { URL.revokeObjectURL(video.src); window.clearTimeout(probeTimer); finishProbe(); };
    video.src = URL.createObjectURL(selected);
  };

  const generate = async () => {
    const form = new FormData();
    form.append("file", file); form.append("theme", "street_glow"); form.append("speech_language", speechLanguage);
    form.append("stt_engine", sttEngine);
    setProcessing(true);
    setProgress(2);
    setProcessingLabel("Uploading video");
    try {
      const { data } = await api.post("/projects/process", form, { headers: { "Content-Type": "multipart/form-data" } });
      let project = data;
      while (["queued", "processing"].includes(project.status)) {
        setProgress(project.progress || 5);
        setProcessingLabel(project.processing_label || "Generating captions");
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        project = (await api.get(`/projects/${project.project_id}`)).data;
      }
      if (project.status === "failed") throw new Error(project.error_message || "Caption processing failed");
      onCreated(project);
      toast.success("Hinglish captions are ready");
    } catch (error) {
      if (error.response?.status === 402) onPaywall();
      else toast.error(errorMessage(error));
    } finally {
      setProcessing(false);
      setProgress(0);
      setProcessingLabel("");
    }
  };

  return (
    <main className="upload-workspace" data-testid="video-upload-workspace">
      <section className="upload-copy">
        <p className="eyebrow" data-testid="workspace-status-label"><Waveform size={17} /> NEW CAPTION SESSION</p>
        <h1 data-testid="upload-page-heading">Drop a video.<br /><span>Captain the words.</span></h1>
        <p data-testid="upload-page-description">Sarvam listens to the video word by word. You’ll see exactly what it heard before it’s converted into Roman Hinglish and styled.</p>
        <div className="language-selector" data-testid="stt-engine-selector">
          <span>SPEECH ENGINE</span>
          <select className="engine-select" value={sttEngine} onChange={(e) => setSttEngine(e.target.value)} disabled={processing} data-testid="stt-engine-select">
            <option value="sarvam">Sarvam · no OpenAI key needed</option>
            <option value="whisper">Whisper timing + Sarvam text · needs OpenAI key</option>
          </select>
        </div>
        <div className="language-selector" data-testid="speech-language-selector">
          <span data-testid="speech-language-label">SPEECH MODE</span>
          <button className={speechLanguage === "auto" ? "active" : ""} onClick={() => setSpeechLanguage("auto")} data-testid="speech-language-auto-button">Adaptive Hinglish · Recommended</button>
          <button className={speechLanguage === "hi" ? "active" : ""} onClick={() => setSpeechLanguage("hi")} data-testid="speech-language-hinglish-button">Hindi only</button>
        </div>
        <div className="format-strip" data-testid="supported-video-formats"><span>MP4 / MOV</span><span>UNLIMITED TESTING · 120 SEC</span><span>RAW TRANSCRIPT VISIBLE</span></div>
      </section>
      <section className={`upload-zone ${file ? "has-file" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); inspect(e.dataTransfer.files[0]); }} data-testid="video-upload-dropzone">
        <input ref={input} type="file" accept="video/mp4,video/quicktime" onChange={(e) => inspect(e.target.files[0])} hidden data-testid="video-file-input" />
        <div className="upload-icon"><FilmStrip size={42} weight="duotone" /></div>
        {file ? <>
          <h2 data-testid="selected-video-name">{file.name}</h2>
          <p data-testid="selected-video-metadata">{duration ? `${duration.toFixed(1)} sec · ` : probing ? "Checking duration · " : "Duration checked on upload · "}{file.size < 1048576 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1048576).toFixed(1)} MB`}</p>
          <div className="upload-buttons">
            <Button variant="outline" disabled={processing} onClick={() => input.current.click()} data-testid="replace-video-button">Replace</Button>
            <Button onClick={generate} disabled={processing || probing} data-testid="generate-captions-button">{processing ? "Transcribing & styling…" : probing ? "Checking video…" : "Generate Hinglish captions"}</Button>
          </div>
          {processing && <div className="processing-progress" data-testid="caption-processing-progress">
            <div><span data-testid="caption-processing-label">{processingLabel}</span><b data-testid="caption-processing-percent">{progress}%</b></div>
            <i><em style={{ width: `${progress}%` }} /></i>
            <p data-testid="caption-processing-note">You can keep this tab open—long videos continue safely in the background.</p>
          </div>}
        </> : <>
          <h2 data-testid="upload-dropzone-heading">Drag your video here</h2>
          <p data-testid="upload-dropzone-description">or choose a file from your device</p>
          <Button onClick={() => input.current.click()} data-testid="choose-video-button"><UploadSimple size={19} /> Choose video</Button>
        </>}
      </section>
    </main>
  );
};