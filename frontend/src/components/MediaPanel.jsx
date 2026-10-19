import { FilmSlate } from "@phosphor-icons/react";

const formatSize = (bytes) => {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
};

export const MediaPanel = ({ project }) => {
  const format = project.name?.includes(".") ? project.name.split(".").pop().toUpperCase() : "MP4";
  return (
    <aside className="tool-panel" data-testid="media-panel">
      <div className="panel-heading"><FilmSlate size={18} /><div><span>SOURCE FILE</span><h2 data-testid="media-panel-heading">Media info</h2></div></div>
      <div className="meta-rows" data-testid="media-meta-rows">
        <div><span>File name</span><b data-testid="media-filename">{project.name}</b></div>
        <div><span>Duration</span><b data-testid="media-duration">{project.duration?.toFixed(1)}s</b></div>
        <div><span>Resolution</span><b data-testid="media-resolution">{project.width && project.height ? `${project.width}×${project.height}` : "—"}</b></div>
        <div><span>File size</span><b data-testid="media-size">{formatSize(project.size_bytes)}</b></div>
        <div><span>Format</span><b data-testid="media-format">{format}</b></div>
        <div><span>Status</span><b data-testid="media-status">{project.status}</b></div>
      </div>
      <div className="tool-divider" />
      <p className="panel-note">To caption a different clip, start a new session from the top-left.</p>
    </aside>
  );
};
