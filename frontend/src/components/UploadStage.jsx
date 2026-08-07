import { useRef, useState } from "react";
import { FilmStrip, UploadSimple, Waveform } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

export const UploadStage = ({ onCreated, onPaywall }) => {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(null);
  const [processing, setProcessing] = useState(false);

  const inspect = (selected) => {
    if (!selected) return;
    if (!/\.(mp4|mov)$/i.test(selected.name)) return toast.error("Choose an MP4 or MOV video");
    setFile(selected);
    setDuration(null);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      if (video.duration > 120) return toast.error("Video must be 120 seconds or shorter");
      setDuration(video.duration);
    };
    video.onerror = () => URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(selected);
  };

  const generate = async () => {
    const form = new FormData();
    form.append("file", file); form.append("theme", "viral");
    setProcessing(true);
    try {
      const { data } = await api.post("/projects/process", form, { headers: { "Content-Type": "multipart/form-data" } });
      onCreated(data);
      toast.success("Hinglish captions are ready");
    } catch (error) {
      if (error.response?.status === 402) onPaywall();
      toast.error(errorMessage(error));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <main className="upload-workspace" data-testid="video-upload-workspace">
      <section className="upload-copy">
        <p className="eyebrow" data-testid="workspace-status-label"><Waveform size={17} /> NEW CAPTION SESSION</p>
        <h1 data-testid="upload-page-heading">Drop a video.<br /><span>Captain the words.</span></h1>
        <p data-testid="upload-page-description">Whisper-1 catches every spoken word. GPT 5.6 Terra turns Hindi into exact Roman Hinglish and picks the moments that deserve impact.</p>
        <div className="format-strip" data-testid="supported-video-formats"><span>MP4 / MOV</span><span>UP TO 120 SEC</span><span>WORD-LEVEL TIMING</span></div>
      </section>
      <section className={`upload-zone ${file ? "has-file" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); inspect(e.dataTransfer.files[0]); }} data-testid="video-upload-dropzone">
        <input ref={input} type="file" accept="video/mp4,video/quicktime" onChange={(e) => inspect(e.target.files[0])} hidden data-testid="video-file-input" />
        <div className="upload-icon"><FilmStrip size={42} weight="duotone" /></div>
        {file ? <>
          <h2 data-testid="selected-video-name">{file.name}</h2>
          <p data-testid="selected-video-metadata">{duration ? `${duration.toFixed(1)} sec · ` : "Duration checked on upload · "}{(file.size / 1048576).toFixed(1)} MB</p>
          <div className="upload-buttons">
            <Button variant="outline" onClick={() => input.current.click()} data-testid="replace-video-button">Replace</Button>
            <Button onClick={generate} disabled={processing} data-testid="generate-captions-button">{processing ? "Transcribing & styling…" : "Generate Hinglish captions"}</Button>
          </div>
        </> : <>
          <h2 data-testid="upload-dropzone-heading">Drag your video here</h2>
          <p data-testid="upload-dropzone-description">or choose a file from your device</p>
          <Button onClick={() => input.current.click()} data-testid="choose-video-button"><UploadSimple size={19} /> Choose video</Button>
        </>}
      </section>
    </main>
  );
};