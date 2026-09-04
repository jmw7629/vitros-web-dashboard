import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRole } from "../hooks/useRole";
import { Box, Shield, Wrench } from "lucide-react";

export function RoleLogin() {
  const { setRole } = useRole();
  const { signIn } = useAuthActions();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showEngineer, setShowEngineer] = useState(false);
  const [password, setPassword] = useState("");
  const [initials, setInitials] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const completeSignIn = (role: "engineer" | "superuser") => {
    // This is only a presentation hint. useRole authorizes exclusively from the
    // authenticated server user returned by Convex Auth.
    setRole(role);
    navigate("/dashboard");
  };

  const handleEngineer = () => {
    setShowEngineer(true);
    setInitials("");
    setError("");
  };

  const handleEngineerSubmit = async () => {
    const normalized = initials.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(normalized)) {
      setError("Enter your active employee initials");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      await signIn("vitros-role", { role: "engineer", initials: normalized });
      setShowEngineer(false);
      completeSignIn("engineer");
    } catch {
      setError("Unable to verify an active employee with those initials");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuperuserClick = () => {
    setShowPassword(true);
    setPassword("");
    setError("");
  };

  const handlePasswordSubmit = async () => {
    if (!password || password.length > 256) {
      setError("Superuser verification failed");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      await signIn("vitros-role", { role: "superuser", secret: password });
      setShowPassword(false);
      setPassword("");
      completeSignIn("superuser");
    } catch {
      setError("Superuser verification failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl mb-5 shadow-2xl shadow-blue-500/30">
              <Box className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-white tracking-tight">
              VITROS Inventory
            </h1>
            <p className="text-blue-300 text-lg mt-2">Management System</p>
            <div className="flex items-center justify-center gap-2 mt-3">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-blue-500/50" />
              <span className="text-sm text-slate-400 font-medium tracking-wide">
                VITROS 5600 / 7600 Analyzers
              </span>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-blue-500/50" />
            </div>
          </div>

          <div className="bg-white/[0.07] backdrop-blur-md rounded-2xl border border-white/10 p-8 shadow-2xl">
            <h2 className="text-xl font-semibold text-white text-center mb-2">
              Welcome
            </h2>
            <p className="text-sm text-slate-400 text-center mb-8">
              Select your role to access the inventory system
            </p>

            <div className="space-y-4">
              <button
                onClick={handleSuperuserClick}
                className="w-full flex items-center gap-5 p-5 rounded-xl bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/25 hover:from-purple-600/30 hover:to-blue-600/30 hover:border-purple-400/40 transition-all duration-200 group"
              >
                <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-200">
                  <Shield className="w-7 h-7 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-bold text-white text-lg">Superuser</p>
                  <p className="text-sm text-purple-200/70">
                    Full system access · Password required
                  </p>
                </div>
                <div className="text-purple-400/50 group-hover:text-purple-300 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              <button
                onClick={handleEngineer}
                className="w-full flex items-center gap-5 p-5 rounded-xl bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border border-emerald-500/25 hover:from-emerald-600/30 hover:to-teal-600/30 hover:border-emerald-400/40 transition-all duration-200 group"
              >
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-200">
                  <Wrench className="w-7 h-7 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-bold text-white text-lg">Engineer</p>
                  <p className="text-sm text-emerald-200/70">
                    Standard access · Active employee initials
                  </p>
                </div>
                <div className="text-emerald-400/50 group-hover:text-emerald-300 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          </div>

          {showEngineer && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !isSubmitting && setShowEngineer(false)}>
              <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-1">Engineer Sign In</h3>
                <p className="text-sm text-slate-400 mb-4">Enter your configured active employee initials.</p>
                <input
                  type="text"
                  value={initials}
                  onChange={(e) => setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
                  onKeyDown={(e) => e.key === "Enter" && !isSubmitting && void handleEngineerSubmit()}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-white uppercase placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-3"
                  placeholder="Initials"
                  autoComplete="off"
                  autoFocus
                  disabled={isSubmitting}
                />
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowEngineer(false)}
                    className="flex-1 px-4 py-2.5 bg-slate-600 text-white rounded-xl font-semibold hover:bg-slate-500 transition disabled:opacity-50"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleEngineerSubmit()}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-500 transition disabled:opacity-50"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Verifying…" : "Continue"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showPassword && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !isSubmitting && setShowPassword(false)}>
              <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-4">Enter Superuser Password</h3>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.slice(0, 256))}
                  onKeyDown={(e) => e.key === "Enter" && !isSubmitting && void handlePasswordSubmit()}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                  placeholder="Password"
                  autoComplete="current-password"
                  autoFocus
                  disabled={isSubmitting}
                />
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowPassword(false)}
                    className="flex-1 px-4 py-2.5 bg-slate-600 text-white rounded-xl font-semibold hover:bg-slate-500 transition disabled:opacity-50"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handlePasswordSubmit()}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition disabled:opacity-50"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Verifying…" : "Login"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="text-center mt-8">
            <p className="text-slate-500 text-sm font-medium">QuidelOrtho</p>
            <p className="text-slate-600 text-xs mt-1">Inventory Management · Field Service</p>
          </div>
        </div>
      </div>
    </div>
  );
}
