export const CURATED_FONTS = [
  "Outfit", "Anton", "Bebas Neue", "Oswald", "Montserrat", "Poppins",
  "Barlow Condensed", "Archivo Black", "Black Ops One", "Bangers",
  "Permanent Marker", "Playfair Display", "Cormorant Garamond", "DM Sans",
  "Manrope", "Sora", "Rubik", "Nunito Sans", "Lora", "Raleway",
  "Archivo", "Urbanist", "Fjalla One", "Teko", "Kanit",
];

const style = (overrides = {}) => ({
  fontFamily: "Outfit", fontWeight: 800, fontSize: 56, color: "#FFFFFF",
  accentColor: "#FF3B30", colorMode: "solid", backgroundColor: "#00000000",
  outlineColor: "#050505", outlineWidth: 4, shadow: 2, x: 50, y: 78,
  align: "center", uppercase: false, italic: false, underline: false,
  letterSpacing: 0, animation: "pop", ...overrides,
});

export const DEFAULT_EDITOR_STYLE = style();

export const CAPTION_TEMPLATES = [
  { id: "viral-punch", name: "Viral Punch", category: "Viral", sample: "STOP THE SCROLL", style: style({ fontFamily: "Anton", fontSize: 64, accentColor: "#FF3B30", animation: "punch", uppercase: true }) },
  { id: "karachi", name: "Karachi", category: "Bold", sample: "THE QUICK BROWN FOX", style: style({ fontFamily: "Archivo Black", fontSize: 52, colorMode: "gradient", color: "#FF1744", accentColor: "#FFB000", letterSpacing: 2 }) },
  { id: "kalakar", name: "Kalakar", category: "Viral", sample: "Hello and WELCOME", style: style({ fontFamily: "Bebas Neue", fontSize: 62, color: "#D7FF00", accentColor: "#FFFFFF", animation: "rise" }) },
  { id: "underline", name: "Underline", category: "Bold", sample: "The quick brown fox jumps", style: style({ fontFamily: "Montserrat", fontSize: 48, backgroundColor: "#FF168F", outlineWidth: 0, shadow: 0 }) },
  { id: "clean-motion", name: "Clean Motion", category: "Clean", sample: "Clean captions win", style: style({ fontFamily: "DM Sans", fontWeight: 700, fontSize: 48, outlineWidth: 2, animation: "fade" }) },
  { id: "cinema-gold", name: "Cinema Gold", category: "Cinematic", sample: "A STORY BEGINS", style: style({ fontFamily: "Playfair Display", fontSize: 54, color: "#FFF5D6", accentColor: "#FFB800", animation: "fade", letterSpacing: 1 }) },
  { id: "podcast-card", name: "Podcast Card", category: "Podcast", sample: "Here is the truth", style: style({ fontFamily: "Manrope", fontSize: 46, backgroundColor: "#151515DD", outlineWidth: 0, y: 82 }) },
  { id: "marker-note", name: "Marker Note", category: "Creator", sample: "Remember this", style: style({ fontFamily: "Permanent Marker", fontSize: 52, color: "#FFF266", outlineWidth: 2, animation: "draw" }) },
  { id: "sports-impact", name: "Sports Impact", category: "Bold", sample: "GAME CHANGER", style: style({ fontFamily: "Teko", fontSize: 72, uppercase: true, accentColor: "#49E8A4", animation: "punch" }) },
  { id: "newsroom", name: "Newsroom", category: "Clean", sample: "Breaking down the moment", style: style({ fontFamily: "Archivo", fontSize: 44, backgroundColor: "#EAF0F4", color: "#101214", outlineWidth: 0, shadow: 0, align: "left", x: 28 }) },
  { id: "neon-pop", name: "Neon Pop", category: "Viral", sample: "THIS IS WILD", style: style({ fontFamily: "Black Ops One", fontSize: 56, color: "#8CFF00", accentColor: "#00E5FF", outlineColor: "#25104D", outlineWidth: 6 }) },
  { id: "editorial", name: "Editorial", category: "Cinematic", sample: "Details make the story", style: style({ fontFamily: "Cormorant Garamond", fontWeight: 700, fontSize: 58, italic: true, outlineWidth: 1, animation: "fade" }) },
  { id: "minimal-lower", name: "Minimal Lower", category: "Clean", sample: "simple and precise", style: style({ fontFamily: "Sora", fontSize: 40, outlineWidth: 0, shadow: 3, y: 86 }) },
  { id: "comic-burst", name: "Comic Burst", category: "Creator", sample: "NO WAY!", style: style({ fontFamily: "Bangers", fontSize: 68, color: "#FFE600", accentColor: "#FF4D00", outlineWidth: 6, animation: "punch", letterSpacing: 2 }) },
  { id: "luxury-serif", name: "Luxury Serif", category: "Cinematic", sample: "Quiet confidence", style: style({ fontFamily: "Lora", fontSize: 50, color: "#F7EFE0", outlineWidth: 1, animation: "fade" }) },
  { id: "reel-blue", name: "Reel Blue", category: "Viral", sample: "Watch till the end", style: style({ fontFamily: "Kanit", fontSize: 50, backgroundColor: "#007AFF", outlineWidth: 0, animation: "rise" }) },
  { id: "condensed-stack", name: "Condensed Stack", category: "Bold", sample: "FAST CLEAR STRONG", style: style({ fontFamily: "Barlow Condensed", fontSize: 64, uppercase: true, letterSpacing: 1, animation: "pop" }) },
  { id: "friendly-talk", name: "Friendly Talk", category: "Podcast", sample: "Let me explain", style: style({ fontFamily: "Nunito Sans", fontSize: 46, color: "#FFFFFF", accentColor: "#6EE7B7", outlineWidth: 3 }) },
  { id: "documentary", name: "Documentary", category: "Cinematic", sample: "THE UNTOLD CHAPTER", style: style({ fontFamily: "Fjalla One", fontSize: 50, uppercase: true, letterSpacing: 3, y: 84, animation: "fade" }) },
  { id: "soft-gradient", name: "Soft Gradient", category: "Creator", sample: "Create your moment", style: style({ fontFamily: "Urbanist", fontSize: 50, colorMode: "gradient", color: "#FFFFFF", accentColor: "#58C7FF", outlineWidth: 2, animation: "rise" }) },
];

export const buildCaptionGroups = (words, maxWords = 4) => {
  const groups = [];
  let bucket = [];
  words.forEach((word, index) => {
    const previous = bucket[bucket.length - 1];
    if (bucket.length && (bucket.length >= maxWords || word.start - previous.end > 0.7)) {
      groups.push(bucket); bucket = [];
    }
    bucket.push({ ...word, sourceIndex: index });
  });
  if (bucket.length) groups.push(bucket);
  return groups.map((group, index) => ({
    id: `caption-${index}-${Math.round(group[0].start * 100)}`,
    word_indices: group.map((word) => word.sourceIndex),
    text: group.map((word) => word.text).join(" "),
    start: group[0].start, end: group[group.length - 1].end,
    style: {}, template_id: null,
  }));
};