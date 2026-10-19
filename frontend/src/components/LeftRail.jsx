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

// Only Captions is wired to a real panel today. The rest mirror Captik's
// sidebar so the layout reads right, and announce themselves as upcoming
// instead of silently doing nothing when clicked.
export const LeftRail = ({ active, onSelect }) => (
  <nav className="left-rail" data-testid="left-rail">
    {sections.map(({ id, label, icon: Icon }) => {
      const enabled = id === "captions";
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
