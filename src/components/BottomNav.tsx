import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useRole } from "../hooks/useRole";
import { useTheme, THEME_PALETTES, type ThemeMode } from "../contexts/ThemeContext";

export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setRole } = useRole();
  const { themeMode, setThemeMode, palette } = useTheme();
  const [showThemePicker, setShowThemePicker] = useState(false);

  const handleLogout = () => {
    setRole(null);
    localStorage.removeItem("vitros-role");
    localStorage.removeItem("vitros-tab");
    navigate("/");
  };

  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { icon: "📷", label: "Scan", path: "/scan-kiosk" },
    { icon: "📊", label: "Dashboard", path: "/dashboard" },
    { icon: "✅", label: "Count", path: "/cycle-count" },
    { icon: "⚙️", label: "Settings", path: "/settings" },
  ];

  return (
    <>
      {/* Theme Picker Modal */}
      {showThemePicker && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center"
          onClick={() => setShowThemePicker(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-md mx-4 mb-20 rounded-2xl overflow-hidden shadow-2xl"
            style={{ backgroundColor: palette.cardBg, border: `1px solid ${palette.cardBorder}` }}
            onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-2">
              <h3 className="text-base font-bold" style={{ color: palette.textPrimary }}>🎨 Choose Theme</h3>
              <p className="text-xs mt-0.5" style={{ color: palette.textMuted }}>Select your preferred appearance</p>
            </div>
            <div className="px-4 pb-4 grid grid-cols-1 gap-2">
              {Object.entries(THEME_PALETTES).map(([key, p]) => {
                const active = key === themeMode;
                return (
                  <button
                    key={key}
                    onClick={() => { setThemeMode(key as ThemeMode); setShowThemePicker(false); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                    style={{
                      backgroundColor: active ? `${p.accentBlue}22` : `${p.pageBg}`,
                      border: `2px solid ${active ? p.accentBlue : p.cardBorder}`,
                    }}>
                    {/* Color Preview Dots */}
                    <div className="flex gap-1.5 shrink-0">
                      <div className="w-5 h-5 rounded-full" style={{ backgroundColor: p.pageBg, border: `1px solid ${p.cardBorder}` }} />
                      <div className="w-5 h-5 rounded-full" style={{ backgroundColor: p.cardBg, border: `1px solid ${p.cardBorder}` }} />
                      <div className="w-5 h-5 rounded-full" style={{ backgroundColor: p.accentBlue }} />
                      <div className="w-5 h-5 rounded-full" style={{ backgroundColor: p.statusOk }} />
                    </div>
                    <div className="flex-1 text-left">
                      <span className="text-sm font-semibold" style={{ color: palette.textPrimary }}>
                        {p.emoji} {p.label}
                      </span>
                    </div>
                    {active && (
                      <span className="text-sm">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t safe-area-bottom"
        style={{ backgroundColor: palette.navBg, borderColor: palette.navBorder }}>
        <div className="flex items-center justify-around max-w-lg mx-auto h-14">
          {navItems.map(item => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all"
                style={{
                  color: active ? palette.accentBlue : palette.textMuted,
                }}>
                <span className="text-lg leading-none">{item.icon}</span>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}

          {/* Theme Button */}
          <button
            onClick={() => setShowThemePicker(true)}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all"
            style={{ color: showThemePicker ? palette.accentBlue : palette.textMuted }}>
            <span className="text-lg leading-none">🎨</span>
            <span className="text-[10px] font-medium">Theme</span>
          </button>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all"
            style={{ color: palette.textMuted }}>
            <span className="text-lg leading-none">🚪</span>
            <span className="text-[10px] font-medium">Logout</span>
          </button>
        </div>
      </nav>
    </>
  );
}
