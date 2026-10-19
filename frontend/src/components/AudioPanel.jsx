import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";

export const AudioPanel = ({ volume, onVolume, muted, onMuted }) => (
  <aside className="tool-panel" data-testid="audio-panel">
    <div className="panel-heading"><SpeakerHigh size={18} /><div><span>ORIGINAL AUDIO</span><h2 data-testid="audio-panel-heading">Volume</h2></div></div>
    <label className="control-label" data-testid="audio-volume-label">Level <b data-testid="audio-volume-value">{muted ? "Muted" : `${volume}%`}</b></label>
    <Slider min={0} max={200} step={5} value={[volume]} disabled={muted} onValueChange={([value]) => onVolume(value)} data-testid="audio-volume-slider" />
    <button className={`emphasis-toggle ${muted ? "active" : ""}`} onClick={() => onMuted(!muted)} data-testid="audio-mute-toggle">
      <span>{muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />} Mute original audio</span><i />
    </button>
    <p className="panel-note">Boosting past 100% only affects the exported MP4 - browser preview volume is capped at 100%.</p>
  </aside>
);
