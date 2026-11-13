// أيقونات الواجهة: خطوط هندسية بسيطة مرسومة هنا، بلا مكتبة ولا ملف خارجي (سياسة المحتوى تمنع
// الأصول البعيدة). كل أيقونة زخرفة: `aria-hidden` دائمًا، والاسم يأتي من النص المجاور أو من
// `aria-label` على الزر نفسه. اللون `currentColor` فتتبع الأيقونة السمة وحالة الزر.

export type IconName =
  | "home"
  | "projects"
  | "missions"
  | "agents"
  | "skills"
  | "browser"
  | "memory"
  | "connectors"
  | "activity"
  | "settings"
  | "plus"
  | "search"
  | "schedule"
  | "library"
  | "paperclip"
  | "mic"
  | "arrow-up"
  | "sidebar"
  | "chip"
  | "sun"
  | "moon"
  | "globe"
  | "shield"
  | "file"
  | "sparkle"
  | "research"
  | "report"
  | "data"
  | "slides"
  | "web"
  | "code"
  | "check"
  | "grid"
  | "list"
  | "stop"
  | "copy"
  | "more"
  | "chevron"
  | "cursor-screen"
  | "puzzle"
  | "customize"
  | "filter"
  | "chevrons-up"
  | "download"
  | "terminal"
  | "brain"
  | "refresh"
  | "close"
  | "user"
  | "info"
  | "keyboard"
  | "sliders"
  | "database"
  | "edit"
  | "pin"
  | "star"
  | "archive"
  | "trash"
  | "eye"
  | "folder-move"
  | "upload"
  | "monitor"
  | "laptop"
  | "folder"
  | "box"
  | "creations"
  | "automation"
  | "addons"
  | "build"
  | "shapes"
  | "arrow-side"
  | "bell"
  | "chat"
  | "undo";

// كل مسار داخل مربّع 24×24، بخطّ عرضه 1.75.
const PATHS: Record<IconName, string> = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  projects: "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z",
  missions: "M5 4.5h10.5L19 8v11.5H5zM15.5 4.5V8H19M8.5 12.5l2.2 2.2 4.3-4.4",
  agents: "M12 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 19.5c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5",
  skills: "M13.5 3.5 6 13.5h5.5L10.5 20.5 18 10.5h-5.5z",
  browser: "M3.5 6A1.5 1.5 0 0 1 5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18zM3.5 9h17M6.5 6.8h.01M9 6.8h.01",
  memory: "M7 4.5h10A1.5 1.5 0 0 1 18.5 6v13.5L12 16l-6.5 3.5V6A1.5 1.5 0 0 1 7 4.5z",
  connectors: "M9 7.5V4M15 7.5V4M7 7.5h10v3.5a5 5 0 0 1-10 0zM12 16v4.5",
  activity: "M3.5 12.5h4l2.5-6 4 11 2.5-5h4",
  settings: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6",
  plus: "M12 5v14M5 12h14",
  search: "M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l5 5",
  schedule: "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4.5l3 1.8",
  library: "M5 4.5v15M9 4.5v15M13 5.2l4.4-1.1 3.4 14.6-4.4 1.1z",
  paperclip: "M16.5 8.5 9.8 15.2a2 2 0 0 1-2.8-2.8l7.1-7.1a3.5 3.5 0 0 1 5 5l-7.4 7.4a5 5 0 0 1-7.1-7.1L11 4.3",
  mic: "M12 3.5a2.8 2.8 0 0 1 2.8 2.8v5.4a2.8 2.8 0 0 1-5.6 0V6.3A2.8 2.8 0 0 1 12 3.5zM6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5",
  "arrow-up": "M12 19V5M6 11l6-6 6 6",
  sidebar: "M4.5 5.5h15v13h-15zM9.5 5.5v13",
  chip: "M7 7h10v10H7zM10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 3v1.8M12 19.2V21M21 12h-1.8M4.8 12H3M18.4 5.6l-1.3 1.3M6.9 17.1l-1.3 1.3M18.4 18.4l-1.3-1.3M6.9 6.9 5.6 5.6",
  moon: "M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z",
  globe: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM3.5 12h17M12 3.5c2.3 2.3 3.4 5.2 3.4 8.5s-1.1 6.2-3.4 8.5M12 3.5C9.7 5.8 8.6 8.7 8.6 12s1.1 6.2 3.4 8.5",
  shield: "M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6zM9 12l2.2 2.2L15.5 10",
  file: "M6.5 3.5H14l4 4v13H6.5zM14 3.5v4h4",
  sparkle: "M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6-5.6-1.9 5.6-1.9zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  research: "M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l5 5M8 10.5h5M10.5 8v5",
  report: "M6.5 3.5H14l4 4v13H6.5zM14 3.5v4h4M9 12h6M9 15.5h6M9 8.5h2.5",
  data: "M5 19.5V13M10 19.5V8M15 19.5v-9M20 19.5V5M3.5 19.5h17",
  slides: "M3.5 5.5h17v10h-17zM12 15.5v4M8.5 19.5h7",
  web: "M8 8.5 4.5 12 8 15.5M16 8.5l3.5 3.5-3.5 3.5M13.5 6.5l-3 11",
  code: "M4.5 5.5h15v13h-15zM8 10l2.5 2L8 14M12.5 14.5h3.5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  grid: "M4.5 4.5h6.5V11H4.5zM13 4.5h6.5V11H13zM4.5 13h6.5v6.5H4.5zM13 13h6.5v6.5H13z",
  list: "M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01",
  stop: "M8 8h8v8H8z",
  copy: "M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4",
  more: "M4.8 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0zM11 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0zM17.2 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0z",
  chevron: "M9.5 6.5 15 12l-5.5 5.5",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  user: "M12 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 19.5c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5",
  info: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 11v5.5M12 7.8h.01",
  keyboard: "M3.5 6.5h17v11h-17zM7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8",
  sliders: "M4.5 7h9M17.5 7h2M4.5 17h2M10.5 17h9M15.5 5v4M8.5 15v4",
  database: "M12 4c4.4 0 7.5 1.3 7.5 3s-3.1 3-7.5 3-7.5-1.3-7.5-3 3.1-3 7.5-3zM4.5 7v10c0 1.7 3.1 3 7.5 3s7.5-1.3 7.5-3V7M4.5 12c0 1.7 3.1 3 7.5 3s7.5-1.3 7.5-3",
  edit: "M5 19h4L19 9l-4-4L5 15zM13.5 6.5l4 4",
  pin: "M9 4.5h6M10 4.5v5L7 13h10l-3-3.5v-5M12 13v6.5",
  star: "M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z",
  archive: "M4 5.5h16v4H4zM5.5 9.5v9h13v-9M10 13h4",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6",
  eye: "M2.5 12c2.3-4 5.5-6 9.5-6s7.2 2 9.5 6c-2.3 4-5.5 6-9.5 6s-7.2-2-9.5-6zM12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z",
  "folder-move": "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM10 13.5h5M13 11l2.5 2.5L13 16",
  upload: "M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 15v4.5h14V15",
  // مانوس 2.0 (2026-10-05): أجهزة الكمبيوتر، والإنشاءات، والأتمتة، والإضافات، وبطاقتا «بناء» و«إنشاء».
  monitor: "M3.5 5h17v11.5h-17zM9 20h6M12 16.5V20",
  laptop: "M5.5 6h13v9h-13zM3.5 18.5h17",
  folder: "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM3.5 10h17",
  box: "M4 5.5h16v4H4zM5.5 9.5v9h13v-9M10 13h4",
  creations: "M6.5 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6.5 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8.6 8.4l11 8.6M8.6 15.6l11-8.6",
  automation: "M7 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM17 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM7 9.5V12a5 5 0 0 0 5 5h2.5",
  addons: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  build: "M13.5 4 20 10.5l-2.5 2.5L11 6.5zM12.2 7.8 4.5 15.5 8.5 19.5l7.7-7.7",
  shapes: "M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM13.5 13h6.5v6.5h-6.5zM4 20l3.8-6.5 3.7 6.5z",
  "arrow-side": "M5 12h14M13 6l6 6-6 6",
  bell: "M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14zM10 20.5h4",
  undo: "M5 9h10a4.5 4.5 0 0 1 0 9H9M5 9l3.5-3.5M5 9l3.5 3.5",
  // «المزيد» في مانوس 2.0 (قِيس 2026-10-06): Computer Use، ومهارات، وتخصيص؛ وأدوات رأس «المهام».
  "cursor-screen": "M3.5 4.5h17v11h-17zM9 19.5h6M12 15.5v4M10 8l5 2-2 1-1 2z",
  puzzle: "M9 4.5h3.5v2a1.5 1.5 0 0 0 3 0v-2H19v3.5h-2a1.5 1.5 0 0 0 0 3h2v4h-3.5v-2a1.5 1.5 0 0 0-3 0v2H9v-3.5H7a1.5 1.5 0 0 1 0-3h2z",
  customize: "M4.5 4.5h6v6h-6zM13.5 13.5h6v6h-6zM16.5 4.5v6M13.5 7.5h6M4.5 16.5h6M7.5 13.5v6",
  filter: "M4.5 7h15M7.5 12h9M10.5 17h3",
  "chevrons-up": "M7 12.5l5-5 5 5M7 17.5l5-5 5 5",
  download: "M12 4.5v11M7.5 11 12 15.5l4.5-4.5M5 19.5h14",
  terminal: "M3.5 5h17v14h-17zM7 9.5l2.5 2.5L7 14.5M11.5 15h5",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4",
  brain: "M12 5.5a3 3 0 0 0-5.5 1.7A3 3 0 0 0 5 12a3 3 0 0 0 2 4.8 3 3 0 0 0 5 1.2zM12 5.5a3 3 0 0 1 5.5 1.7A3 3 0 0 1 19 12a3 3 0 0 1-2 4.8 3 3 0 0 1-5 1.2z",
  chat: "M5 5.5h14a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H10l-4.5 3.5V16H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z",
};

export function Icon({ name, size = 18, className }: { readonly name: IconName; readonly size?: number; readonly className?: string }) {
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** أيقونة كل وجهة في الشريط الجانبي. */
export const ROUTE_ICONS: Readonly<Record<string, IconName>> = {
  home: "home",
  projects: "projects",
  missions: "missions",
  agents: "agents",
  skills: "skills",
  "browser-computer": "monitor",
  memory: "memory",
  connectors: "addons",
  activity: "activity",
  settings: "settings",
};
