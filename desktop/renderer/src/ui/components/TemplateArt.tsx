// رسوم مصغّرة لقوالب «بناء» و«إنشاء» في الرئيسية.
//
// مانوس 2.0 يعرض لكل قالب صورة معاينة لا أيقونة. هذه رسومنا نحن (SVG مضمّن، بلا صور
// خارجية ولا شيء منسوخ من مانوس): كل رسم يصف شكل المُخرَج نفسه — نافذة موقع، فقاعات
// محادثة، شبكة جدول — بألوان ثابتة تُقرأ في السمتين كما تُقرأ صورة.

const FRAME = "#2b2e35";
const EDGE = "#3b3f47";
const LINE = "#4a4f59";
const SOFT = "#5b616c";

function Window({ x = 8, y = 8, w = 144, h = 80, children }: { readonly x?: number; readonly y?: number; readonly w?: number; readonly h?: number; readonly children?: React.ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" fill={FRAME} stroke={EDGE} />
      <circle cx={x + 8} cy={y + 7} r="2" fill="#ff5f57" />
      <circle cx={x + 15} cy={y + 7} r="2" fill="#febc2e" />
      <circle cx={x + 22} cy={y + 7} r="2" fill="#28c840" />
      {children}
    </g>
  );
}

function Lines({ x, y, widths, gap = 6, color = LINE }: { readonly x: number; readonly y: number; readonly widths: readonly number[]; readonly gap?: number; readonly color?: string }) {
  return (
    <g>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height="2.5" rx="1.25" fill={color} />
      ))}
    </g>
  );
}

const ART: Record<string, () => React.ReactNode> = {
  website: () => (
    <Window>
      <rect x="44" y="24" width="72" height="5" rx="2.5" fill="#d9dde3" />
      <rect x="54" y="33" width="52" height="3" rx="1.5" fill={SOFT} />
      <rect x="66" y="41" width="28" height="7" rx="3.5" fill="#f2f2f2" />
      <rect x="20" y="54" width="120" height="30" rx="3" fill="url(#tpl-sky)" />
    </Window>
  ),
  chatbot: () => (
    <Window>
      <rect x="9" y="15" width="22" height="72" fill="#25282e" />
      <circle cx="20" cy="26" r="4" fill={SOFT} />
      <circle cx="20" cy="38" r="4" fill="#7c6cf2" />
      <circle cx="20" cy="50" r="4" fill={SOFT} />
      <rect x="40" y="22" width="56" height="9" rx="4.5" fill="#3a3e46" />
      <rect x="84" y="36" width="58" height="9" rx="4.5" fill="#7c6cf2" />
      <rect x="40" y="50" width="70" height="9" rx="4.5" fill="#3a3e46" />
      <rect x="40" y="70" width="104" height="11" rx="5.5" fill="#22252b" stroke={EDGE} />
      <circle cx="137" cy="75.5" r="3.5" fill="#7c6cf2" />
    </Window>
  ),
  desktop: () => (
    <g>
      <rect x="4" y="4" width="152" height="88" rx="6" fill="url(#tpl-desk)" />
      <Window x={22} y={16} w={116} h={64}>
        <rect x="23" y="29" width="28" height="50" fill="#25282e" />
        <Lines x={27} y={34} widths={[18, 14, 16, 12]} gap={8} />
        <circle cx="94" cy="50" r="15" fill="none" stroke="#5aa1ff" strokeWidth="3" />
        <rect x="86" y="48" width="16" height="4" rx="2" fill="#d9dde3" />
      </Window>
      <rect x="48" y="84" width="64" height="5" rx="2.5" fill="#ffffff" opacity="0.35" />
    </g>
  ),
  dashboard: () => (
    <Window>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={16 + i * 44} y="20" width="38" height="16" rx="3" fill="#33373f" />
          <rect x={21 + i * 44} y="25" width="14" height="2.5" rx="1" fill={SOFT} />
          <rect x={21 + i * 44} y="30" width="22" height="3" rx="1.5" fill={["#5aa1ff", "#3ecf8e", "#f5a524"][i]} />
        </g>
      ))}
      <rect x="16" y="42" width="128" height="40" rx="3" fill="#33373f" />
      {[14, 22, 18, 28, 24, 32, 26].map((h, i) => (
        <rect key={i} x={24 + i * 16} y={78 - h} width="9" height={h} rx="1.5" fill="#5aa1ff" opacity={0.55 + i * 0.06} />
      ))}
    </Window>
  ),
  extension: () => (
    <Window>
      <rect x="30" y="13" width="84" height="6" rx="3" fill="#22252b" />
      <circle cx="44" cy="50" r="17" fill="#3a3e46" />
      <circle cx="44" cy="50" r="7" fill="#5aa1ff" />
      <rect x="82" y="22" width="62" height="60" rx="4" fill="#33373f" stroke={EDGE} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="88" y={31 + i * 14} width="26" height="3" rx="1.5" fill={LINE} />
          <rect x="124" y={29 + i * 14} width="14" height="7" rx="3.5" fill={i === 2 ? "#4a4f59" : "#2f80ed"} />
          <circle cx={i === 2 ? 128 : 134} cy={32.5 + i * 14} r="2.5" fill="#fff" />
        </g>
      ))}
      <rect x="88" y="71" width="50" height="6" rx="3" fill="#2f80ed" />
    </Window>
  ),
  game: () => (
    <g>
      <rect x="4" y="4" width="152" height="88" rx="6" fill="url(#tpl-forest)" />
      <rect x="4" y="74" width="152" height="18" fill="#5b3a1e" />
      <rect x="4" y="70" width="152" height="6" fill="#4caf50" />
      {[18, 46, 112, 138].map((x, i) => (
        <g key={i}>
          <rect x={x + 5} y={50} width="4" height="20" fill="#5b3a1e" />
          <path d={`M${x} 54 L${x + 7} 28 L${x + 14} 54 Z`} fill="#2e7d32" />
        </g>
      ))}
      <rect x="92" y="52" width="10" height="10" fill="#f5a524" stroke="#8a5a00" />
      <rect x="104" y="52" width="10" height="10" fill="#f5a524" stroke="#8a5a00" />
      <rect x="70" y="58" width="9" height="12" rx="2" fill="#e0e0e0" />
      <circle cx="74.5" cy="54" r="4" fill="#e0e0e0" />
    </g>
  ),
  webapp: () => (
    <Window>
      <rect x="9" y="15" width="142" height="9" fill="#25282e" />
      <Lines x={16} y={18.5} widths={[16, 16, 16]} gap={0} />
      {[0, 1, 2].map((c) => (
        <g key={c}>
          <rect x={16 + c * 44} y="30" width="38" height="52" rx="3" fill="#33373f" />
          {[0, 1, 2].slice(0, 3 - (c === 2 ? 1 : 0)).map((r) => (
            <rect key={r} x={20 + c * 44} y={35 + r * 15} width="30" height="11" rx="2" fill="#3f444d" />
          ))}
          <rect x={20 + c * 44} y="35" width="3" height="11" fill={["#5aa1ff", "#f5a524", "#3ecf8e"][c]} />
        </g>
      ))}
    </Window>
  ),
  script: () => (
    <g>
      <rect x="8" y="8" width="144" height="80" rx="6" fill="#1b1d22" stroke={EDGE} />
      <rect x="8" y="8" width="144" height="12" rx="6" fill="#25282e" />
      <rect x="16" y="12" width="30" height="4" rx="2" fill={SOFT} />
      {[
        [16, 28, 18, "#c792ea"],
        [38, 28, 34, "#82aaff"],
        [24, 37, 42, "#c3e88d"],
        [24, 46, 30, "#f78c6c"],
        [16, 55, 22, "#c792ea"],
        [42, 55, 46, "#89ddff"],
      ].map(([x, y, w, c], i) => (
        <rect key={i} x={x as number} y={y as number} width={w as number} height="3.5" rx="1.75" fill={c as string} />
      ))}
      <path d="M16 70 l5 4 -5 4" stroke="#3ecf8e" strokeWidth="2" fill="none" />
      <rect x="26" y="76" width="10" height="2.5" fill="#3ecf8e" />
    </g>
  ),
  notebook: () => (
    <g>
      <rect x="10" y="10" width="68" height="78" rx="4" fill="#2f3239" stroke={EDGE} />
      <rect x="82" y="10" width="68" height="78" rx="4" fill="#2f3239" stroke={EDGE} />
      <rect x="132" y="10" width="7" height="12" fill="#2f80ed" />
      <Lines x={16} y={20} widths={[40, 32, 44]} color={SOFT} />
      <rect x="16" y="42" width="56" height="18" rx="2" fill="#24272d" />
      <Lines x={20} y={47} widths={[34, 26]} color="#82aaff" />
      <circle cx="30" cy="72" r="5" fill="none" stroke="#5aa1ff" strokeWidth="1.5" />
      <circle cx="56" cy="76" r="5" fill="none" stroke="#5aa1ff" strokeWidth="1.5" />
      <path d="M35 73 L51 75" stroke="#5aa1ff" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="88" y={20 + i * 10} width="5" height="5" rx="1" fill="none" stroke={SOFT} />
          <rect x="97" y={21 + i * 10} width={36 - i * 6} height="2.5" rx="1" fill={LINE} />
        </g>
      ))}
      <rect x="88" y="54" width="56" height="26" rx="3" fill="#24272d" />
      <rect x="92" y="60" width="44" height="4" rx="2" fill="#2f80ed" opacity="0.7" />
      <rect x="92" y="69" width="30" height="4" rx="2" fill="#2f80ed" opacity="0.45" />
    </g>
  ),
  automation: () => (
    <g>
      <path d="M44 48 H66 M94 48 C108 48 108 30 120 30 M94 48 C108 48 108 66 120 66" stroke="#5aa1ff" strokeWidth="1.5" fill="none" />
      <rect x="16" y="34" width="28" height="28" rx="6" fill="#33373f" stroke={EDGE} />
      <Lines x={23} y={42} widths={[14, 10, 14]} gap={5} color={SOFT} />
      <rect x="66" y="32" width="28" height="32" rx="7" fill="#2b2e35" stroke="#5aa1ff" />
      <path d="M74 52 l6-12 6 12 z" fill="none" stroke="#d9dde3" strokeWidth="1.5" />
      <rect x="120" y="18" width="24" height="24" rx="6" fill="#33373f" stroke={EDGE} />
      <rect x="126" y="25" width="12" height="8" rx="2" fill="none" stroke="#d9dde3" />
      <rect x="120" y="54" width="24" height="24" rx="6" fill="#33373f" stroke={EDGE} />
      <circle cx="132" cy="66" r="6" fill="#3ecf8e" />
      <path d="M129 66 l2 2 4-4" stroke="#fff" strokeWidth="1.5" fill="none" />
    </g>
  ),
  slides: () => (
    <g>
      <rect x="22" y="20" width="118" height="66" rx="4" fill="#3a3e46" transform="rotate(-4 80 53)" />
      <rect x="18" y="14" width="124" height="70" rx="4" fill="url(#tpl-slide)" stroke={EDGE} />
      <rect x="28" y="22" width="40" height="2.5" rx="1" fill="#9fb8ff" opacity="0.8" />
      <rect x="28" y="58" width="74" height="6" rx="2" fill="#ffffff" />
      <rect x="28" y="68" width="54" height="6" rx="2" fill="#ffffff" />
      <path d="M104 14 C122 30 112 52 142 60 V14 Z" fill="#5aa1ff" opacity="0.55" />
    </g>
  ),
  document: () => (
    <g>
      <rect x="62" y="12" width="64" height="76" rx="3" fill="#2f3239" stroke={EDGE} transform="rotate(5 94 50)" />
      <rect x="34" y="12" width="64" height="76" rx="3" fill="#33363d" stroke={EDGE} transform="rotate(-6 66 50)" />
      <g transform="rotate(-6 66 50)">
        <rect x="40" y="20" width="44" height="4" rx="1.5" fill="#d9dde3" />
        <Lines x={40} y={30} widths={[50, 46, 52, 40, 50, 44, 48, 36]} gap={6} color={SOFT} />
      </g>
    </g>
  ),
  sheet: () => (
    <g>
      <rect x="10" y="12" width="140" height="74" rx="4" fill="#2b2e35" stroke={EDGE} />
      <rect x="10" y="12" width="140" height="11" rx="4" fill="#1f5f3a" />
      {[0, 1, 2, 3, 4].map((r) => (
        <g key={r}>
          <rect x="10" y={23 + r * 12} width="140" height="0.8" fill={EDGE} />
          <Lines x={18} y={28 + r * 12} widths={[18]} color={SOFT} />
          {[0, 1, 2].map((c) => (
            <rect key={c} x={54 + c * 32} y={28 + r * 12} width="16" height="2.5" rx="1" fill={LINE} />
          ))}
        </g>
      ))}
      {[48, 80, 112].map((x) => (
        <rect key={x} x={x} y="12" width="0.8" height="74" fill={EDGE} />
      ))}
      <rect x="80" y="35" width="32" height="12" fill="none" stroke="#3ecf8e" strokeWidth="1.5" />
    </g>
  ),
  analysis: () => (
    <g>
      <rect x="8" y="10" width="144" height="76" rx="4" fill="#2b2e35" stroke={EDGE} />
      {[14, 20, 27, 34, 42].map((h, i) => (
        <rect key={i} x={20 + i * 15} y={74 - h} width="10" height={h} rx="1.5" fill="#f59a3a" />
      ))}
      <path d="M22 58 L37 52 L52 45 L67 38 L82 30" stroke="#fbd38d" strokeWidth="1.2" fill="none" />
      <circle cx="122" cy="44" r="16" fill="none" stroke="#b39dfa" strokeWidth="8" />
      <path d="M122 28 A16 16 0 0 1 137 50" stroke="#e9e3ff" strokeWidth="8" fill="none" />
      <Lines x={108} y={68} widths={[28, 20]} gap={5} color={SOFT} />
    </g>
  ),
  pdf: () => (
    <g>
      <rect x="44" y="8" width="72" height="80" rx="3" fill="#33363d" stroke={EDGE} />
      <rect x="52" y="16" width="38" height="4" rx="1.5" fill="#d9dde3" />
      <Lines x={52} y={26} widths={[56, 50, 54]} color={SOFT} />
      <rect x="52" y="46" width="56" height="18" rx="2" fill="#2b2e35" stroke={EDGE} />
      <Lines x={56} y={51} widths={[48, 40]} gap={6} />
      <Lines x={52} y={70} widths={[54, 44]} color={SOFT} />
      <rect x="96" y="66" width="28" height="14" rx="3" fill="#e5484d" />
      <text x="110" y="76" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
        PDF
      </text>
    </g>
  ),
  research: () => (
    <g>
      <rect x="14" y="10" width="78" height="78" rx="3" fill="#33363d" stroke={EDGE} />
      <rect x="22" y="18" width="44" height="4" rx="1.5" fill="#d9dde3" />
      <Lines x={22} y={28} widths={[60, 54, 58, 46, 60, 50, 40]} gap={7} color={SOFT} />
      <circle cx="112" cy="40" r="14" fill="none" stroke="#5aa1ff" strokeWidth="3" />
      <path d="M122 50 L136 64" stroke="#5aa1ff" strokeWidth="4" strokeLinecap="round" />
      <rect x="100" y="72" width="16" height="7" rx="3.5" fill="#2f80ed" opacity="0.8" />
      <rect x="120" y="72" width="16" height="7" rx="3.5" fill="#3ecf8e" opacity="0.8" />
    </g>
  ),
};

/** رسم القالب، أو لا شيء لقالب بلا رسم. */
export function TemplateArt({ id }: { readonly id: string }) {
  const draw = ART[id];
  if (draw === undefined) return null;
  return (
    <svg className="tpl-art" viewBox="0 0 160 96" role="presentation" focusable="false">
      <defs>
        <linearGradient id="tpl-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9cc4ff" />
          <stop offset="1" stopColor="#5f8fe0" />
        </linearGradient>
        <linearGradient id="tpl-desk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e3a6e" />
          <stop offset="1" stopColor="#3f6fb5" />
        </linearGradient>
        <linearGradient id="tpl-forest" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7cc4f0" />
          <stop offset="1" stopColor="#bfe6c4" />
        </linearGradient>
        <linearGradient id="tpl-slide" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b1b3a" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {draw()}
    </svg>
  );
}
