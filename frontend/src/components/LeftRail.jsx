import { ClosedCaptioning, FilmSlate, MusicNotes, Shapes, Sparkle, SlidersHorizontal, TextT } from "@phosphor-icons/react";
import { toast } from "sonner";

const sections = [
  { id: "media", label: "Media", icon: FilmSlate },
  { id: "audio", label: "Audio", icon: MusicNotes },
  { id: "text", label: "Text", icon: TextT },
  { id: "elements", label: "Elements", icon: Shapes },
  { id: "captions", label: "Captions", icon: ClosedCaptioning },
  { id: "adjustment", label: "Adjustment", icon: SlidersHorizontal },
  { id: "ai", label: "AI tools", icon: Sparkle },
];

const ENABLED = new Set(["media", "audio", "captions", "elements"]);

// Text/Adjustment/AI tools mirror Captik's sidebar so the layout reads
// right, but aren't built yet - they announce themselves as upcoming
// instead of silently doing nothing when clicked.
export const LeftRail = ({ active, onSelect }) => (
  <nav className="left-rail" data-testid="left-rail">
    {sections.map(({ id, label, icon: Icon }) => {
      const enabled = ENABLED.has(id);
      return (
        <button key={id} className={active === id ? "active" : ""}
          onClick={() => (enabled ? onSelect(id) : toast(`${label} is coming soon`))}
          title={enabled ? label : `${label} — coming soon`}
          data-testid={`left-rail-${id}-button`}>
          <Icon size={21} weight={active === id ? "fill" : "regular"} />
          <span>{label}</span>
        </button>
      );
    })}
  </nav>
);
