import { useMemo, useRef, useState } from "react";
import { DownloadSimple, FloppyDisk, Play, SpinnerGap } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, API_ROOT, errorMessage } from "@/lib/api";
import { ThemePanel } from "@/components/ThemePanel";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { Timeline } from "@/components/Timeline";

const palettes = {
  viral: ["#FFFFFF", "#FF3B30"], cinematic: ["#FFF7DB", "#FFB800"],
  minimal: ["#FFFFFF", "#007AFF"], podcast: ["#FFFFFF", "#A855F7"],
};

export const CaptionStudio = ({ initialProject, onNew }) => {
  const [project, setProject] = useState(initialProject);
  const [words, setWords] = useState(initialProject.words);
  const [theme, setTheme] = useState(initialProject.theme);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [mediaRetry, setMediaRetry] = useState(0);
  const videoRef = useRef(null);
  const activeIndex = words.findIndex((word) => currentTime >= word.start && currentTime <= word.end);
  const visibleWords = useMemo(() => {
    const anchor = activeIndex < 0 ? 0 : activeIndex;
    const start = Math.max(0, anchor - (anchor % 4));
    return words.slice(start, start + 4);
  }, [activeIndex, words]);

  const updateWord = (index, changes) => setWords((current) => current.map((word, i) => i === index ? { ...word, ...changes } : word));
  const chooseTheme = (next) => {
    setTheme(next);
    setWords((current) => current.map((word) => ({ ...word, color: palettes[next][word.important ? 1 : 0] })));
  };
  const save = async () => {
    await api.put(`/projects/${project.project_id}`, { theme, words });
    toast.success("Caption edits saved");
  };
  const render = async () => {
    setRendering(true);
    try {
      await api.put(`/projects/${project.project_id}`, { theme, words });
      const { data } = await api.post(`/projects/${project.project_id}/render`);
      setProject({ ...project, status: "rendered", download_url: data.download_url });
      toast.success("Your captioned video is ready");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setRendering(false); }
  };
  const download = async () => {
    const response = await api.get(`/projects/${project.project_id}/download`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "captain-title.mp4"; anchor.click(); URL.revokeObjectURL(url);
  };
  const togglePlayback = () => videoRef.current?.paused ? videoRef.current.play() : videoRef.current.pause();
  const seek = (time) => { if (videoRef.current) { videoRef.current.currentTime = time; setCurrentTime(time); } };

  return (
    <main className="studio" data-testid="caption-editor-workspace">
      <div className="studio-topbar" data-testid="project-command-bar">
        <div><button onClick={onNew} data-testid="new-project-button">← New session</button><h1 data-testid="current-project-name">{project.name}</h1></div>
        <div className="project-actions">
          <Button variant="outline" onClick={save} data-testid="save-project-button"><FloppyDisk size={18} /> Save</Button>
          {project.status === "rendered" ? <Button onClick={download} data-testid="download-video-button"><DownloadSimple size={19} /> Download MP4</Button> :
            <Button onClick={render} disabled={rendering} data-testid="render-video-button">{rendering ? <SpinnerGap className="spin" size={19} /> : <Play size={18} weight="fill" />} {rendering ? "Rendering…" : "Render video"}</Button>}
        </div>
      </div>
      <div className="studio-grid">
        <ThemePanel theme={theme} onTheme={chooseTheme} selectedWord={words[selectedIndex]} onWordStyle={(change) => updateWord(selectedIndex, change)} />
        <section className="preview-panel" data-testid="video-preview-panel">
          <div className="video-frame">
            <video ref={videoRef} src={`${API_ROOT}/projects/${project.project_id}/media?attempt=${mediaRetry}`} onError={() => { if (mediaRetry < 1) window.setTimeout(() => setMediaRetry(1), 1200); }} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} playsInline data-testid="caption-video-player" />
            <button className="preview-play" onClick={togglePlayback} data-testid="video-preview-play-button"><Play size={28} weight="fill" /></button>
            <div className={`caption-overlay theme-${theme}`} data-testid="live-caption-preview">
              {visibleWords.map((word) => <span key={word.index} className={activeIndex === word.index ? "active" : ""} style={{ color: word.color, fontSize: `${Math.max(20, word.font_size * .62)}px` }} data-testid={`preview-caption-word-${word.index}`}>{word.text}</span>)}
            </div>
          </div>
          <div className="preview-meta"><span data-testid="preview-format-label">9:16 PREVIEW</span><span data-testid="caption-engine-label">WORD SYNC · {theme.toUpperCase()}</span></div>
        </section>
        <TranscriptPanel words={words} originalTranscript={project.source_transcript} activeIndex={activeIndex} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onText={(index, text) => updateWord(index, { text })} />
      </div>
      <Timeline words={words} duration={project.duration} currentTime={currentTime} playing={playing} onToggle={togglePlayback} onSeek={seek} />
    </main>
  );
};