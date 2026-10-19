import { SlidersHorizontal } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";

export const AdjustmentPanel = ({ brightness, contrast, saturation, onBrightness, onContrast, onSaturation, onReset }) => (
  <aside className="tool-panel" data-testid="adjustment-panel">
    <div className="panel-heading"><SlidersHorizontal size={18} /><div><span>COLOR</span><h2 data-testid="adjustment-panel-heading">Adjustment</h2></div></div>
    <label className="control-label" data-testid="brightness-label">Brightness <b data-testid="brightness-value">{brightness > 0 ? "+" : ""}{brightness}</b></label>
    <Slider min={-50} max={50} step={1} value={[brightness]} onValueChange={([value]) => onBrightness(value)} data-testid="brightness-slider" />
    <label className="control-label" data-testid="contrast-label">Contrast <b data-testid="contrast-value">{contrast}%</b></label>
    <Slider min={50} max={200} step={1} value={[contrast]} onValueChange={([value]) => onContrast(value)} data-testid="contrast-slider" />
    <label className="control-label" data-testid="saturation-label">Saturation <b data-testid="saturation-value">{saturation}%</b></label>
    <Slider min={0} max={200} step={1} value={[saturation]} onValueChange={([value]) => onSaturation(value)} data-testid="saturation-slider" />
    <button className="panel-action-button outline" onClick={onReset} data-testid="reset-adjustment-button">Reset to default</button>
    <p className="panel-note">Adjustments apply to the exported MP4 and update this live preview - caption text and stickers stay full-strength regardless of grading.</p>
  </aside>
);
