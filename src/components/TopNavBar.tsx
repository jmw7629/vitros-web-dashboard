import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { useTheme } from "../contexts/ThemeContext";

interface TopNavBarProps {
  onMenuToggle: () => void;
}

export function TopNavBar({ onMenuToggle }: TopNavBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { palette } = useTheme();
  const isRem = location.pathname.startsWith("/rem");

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex items-center h-[48px] px-3 border-b"
      style={{ backgroundColor: palette.navBg, borderColor: palette.navBorder }}>
      {/* Logo */}
      <button onClick={onMenuToggle} className="flex items-center gap-2 mr-4 shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-black"
          style={{ background: `linear-gradient(135deg, ${palette.accentBlue}, ${palette.iconPurple})` }}>
          V
        </div>
        <span className="font-bold text-sm tracking-wide" style={{ color: palette.textPrimary }}>VITROS</span>
      </button>

      {/* Tabs */}
      <nav className="flex items-center gap-0 h-full">
        <TabButton
          label="Inventory"
          active={!isRem}
          onClick={() => navigate("/dashboard")}
          palette={palette}
        />
        <TabButton
          label="REM Tracker"
          active={isRem}
          onClick={() => navigate("/rem/dashboard")}
          palette={palette}
        />
      </nav>
    </header>
  );
}

function TabButton({ label, active, onClick, palette }: { label: string; active: boolean; onClick: () => void; palette: any }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative h-full px-4 text-[13px] font-semibold transition-colors",
      )}
      style={{ color: active ? palette.textPrimary : palette.textMuted }}
    >
      {label}
      {active && (
        <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full"
          style={{ background: `linear-gradient(90deg, ${palette.accentBlue}, ${palette.iconPurple})` }} />
      )}
    </button>
  );
}
