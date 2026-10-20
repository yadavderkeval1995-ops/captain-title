import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUUpLeft, ArrowUUpRight, ArrowsOutSimple, Lightning, PencilSimple,
  Scissors, Sparkle, Square, Target, WaveSquare, X,
} from "@phosphor-icons/react";
import { SFX_TYPES, playSfx } from "@/lib/sfx";

const KINETIC_STYLES = [
  { id: "pulse", label: "Glowing Pulse", icon: Sparkle },
  { id: "pop", label: "Hard Pop", icon: Target },
  { id: "scale", label: "Scale Punch", icon: ArrowsOutSimple },
  { id: "box", label: "Box Highlight", icon: Square },
  { id: "wobble", label: "Wobble", icon: WaveSquare },
  { id: null, label: "None", icon: X },
];

// The floating "FOR THIS MOMENT" action card - opened from a single click on
// a word, wherever that click came from (Script Panel, Timeline, or the
// canvas itself). Always anchored beside the video frame rather than the
// clicked element, so it behaves the same regardless of trigger source.
export const MomentPopover = ({ word, index, frameRect, onClose, onText, onNewLine, onMerge, onKinetic, onEmphasize, onAddSfx, canMergePrevious, canMergeNext }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(word.text);
  const popoverRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setDraft(word.text); setEditing(false); }, [word.text, index]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  useEffect(() => {
    const onDocMouseDown = (e) => { if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose(); };
    const onKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("mousedown", onDocMouseDown); window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  const commitText = () => { if (draft.trim() && draft !== word.text) onText(index, draft.trim()); };

  const POPOVER_WIDTH = 272;
  const left = frameRect ? Math.min(frameRect.right + 16, window.innerWidth - POPOVER_WIDTH - 12) : 12;
  const top = frameRect ? Math.min(Math.max(12, frameRect.top), window.innerHeight - 440) : 12;

  return (
    <AnimatePresence>
      <motion.div ref={popoverRef} className="fixed z-50 rounded-lg border border-zinc-800 bg-[#18181b] p-3 shadow-2xl text-zinc-100"
        style={{ left, top, width: POPOVER_WIDTH }}
        initial={{ opacity: 0, scale: 0.94, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        data-testid={`moment-popover-${index}`}>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[10px] font-bold tracking-[.14em] text-[#ff2d4d]">FOR THIS MOMENT</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white" data-testid="moment-popover-close"><X size={14} weight="bold" /></button>
        </div>

        {editing ? (
          <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { commitText(); setEditing(false); } }}
            onBlur={() => { commitText(); setEditing(false); }}
            className="w-full mb-2.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white outline-none focus:border-[#ff2d4d]"
            data-testid={`moment-edit-input-${index}`} />
        ) : (
          <button onClick={() => setEditing(true)} className="w-full mb-2.5 truncate rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-left text-sm font-semibold text-white hover:border-zinc-600"
            title="Edit spelling" data-testid={`moment-word-label-${index}`}>{word.text}</button>
        )}

        <span className="block mb-1 text-[9px] font-semibold tracking-[.12em] text-zinc-500">KINETIC STYLE</span>
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {KINETIC_STYLES.map(({ id, label, icon: Icon }) => <button key={label} onClick={() => onKinetic(index, id)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-semibold transition-colors ${
              (word.kinetic ?? null) === id ? "bg-[#ff2d4d] text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            data-testid={`moment-kinetic-${id ?? "none"}-${index}`}>
            <Icon size={11} weight="bold" />{label}
          </button>)}
        </div>

        <span className="block mb-1 text-[9px] font-semibold tracking-[.12em] text-zinc-500">SOUND EFFECT</span>
        <div className="mb-2.5 flex gap-1.5">
          {SFX_TYPES.map(({ id, label, icon: Icon, color }) => <button key={id}
            onClick={() => { playSfx(id); onAddSfx(id, word.start, index); }}
            style={{ color }} className="grid h-7 w-7 flex-1 place-items-center rounded bg-zinc-800 hover:bg-zinc-700" title={`${label} at ${word.start.toFixed(2)}s`}
            data-testid={`moment-sfx-${id}-${index}`}>
            <Icon size={14} weight="fill" />
          </button>)}
        </div>

        <span className="block mb-1 text-[9px] font-semibold tracking-[.12em] text-zinc-500">QUICK ACTIONS</span>
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => onEmphasize(index)}
            className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold ${word.emphasize ? "bg-[#EAB308] text-black" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}`}
            data-testid={`moment-emphasize-${index}`}>
            <Lightning size={12} weight="fill" /> Emphasize
          </button>
          <button onClick={() => onNewLine(index)} className="flex items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700"
            data-testid={`moment-split-line-${index}`}>
            <Scissors size={12} /> Split Line
          </button>
          <button onClick={() => onMerge(index, "previous")} disabled={!canMergePrevious}
            className="flex items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-35 disabled:cursor-not-allowed"
            data-testid={`moment-merge-previous-${index}`}>
            <ArrowUUpLeft size={12} /> Merge Prev
          </button>
          <button onClick={() => onMerge(index, "next")} disabled={!canMergeNext}
            className="flex items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-35 disabled:cursor-not-allowed"
            data-testid={`moment-merge-next-${index}`}>
            <ArrowUUpRight size={12} /> Merge Next
          </button>
          <button onClick={() => setEditing(true)} className="col-span-2 flex items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700"
            data-testid={`moment-edit-spelling-${index}`}>
            <PencilSimple size={12} /> Edit Spelling
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
