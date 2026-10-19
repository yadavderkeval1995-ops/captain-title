import { ClosedCaptioning, FilmSlate, MusicNotes, Shapes, Sparkle, SlidersHorizontal, TextT } from "@phosphor-icons/react";

const sections = [
  { id: "media", label: "Media", icon: FilmSlate },
  { id: "audio", label: "Audio", icon: MusicNotes },
  { id: "text", label: "Text", icon: TextT },
  { id: "elements", label: "Elements", icon: Shapes },
  { id: "captions", label: "Captions", icon: ClosedCaptioning },
  { id: "adjustment", label: "Adjustment", icon: SlidersHorizontal },
  { id: "ai", label: "AI tools", icon: Sparkle },
];

export const LeftRail = ({ active, onSelect }) => (
  <nav className="left-rail" data-testid="left-rail">
    {sections.map(({ id, label, icon: Icon }) => (
      <button key={id} className={active === id ? "active" : ""} onClick={() => onSelect(id)} title={label} data-testid={`left-rail-${id}-button`}>
        <Icon size={21} weight={active === id ? "fill" : "regular"} />
        <span>{label}</span>
      </button>
    ))}
  </nav>
);
