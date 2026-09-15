import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRole } from "../hooks/useRole";
import { useConfig } from "../hooks/useConfig";
import { getRoleDefaultRoute, type RoleName } from "../lib/dashboardRoutes";
import { Box, Shield, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";

export function RoleLogin() {
  const { setRole } = useRole();
  const { signIn } = useAuthActions();
  const navigate = useNavigate();
  const { publishedValues } = useConfig();
  const engineerButtonRef = useRef<HTMLButtonElement>(null);
  const superuserButtonRef = useRef<HTMLButtonElement>(null);
  const submissionPending = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [engineerError, setEngineerError] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const completeSignIn = (role: "engineer" | "superuser") => {
    // This is only a presentation hint. useRole authorizes exclusively from the
    // authenticated server user returned by Convex Auth.
    setRole(role);
    const target = getRoleDefaultRoute(role as RoleName, publishedValues);
    navigate(target);
  };

  const handleEngineer = async () => {
    if (submissionPending.current) return;
    submissionPending.current = true;
    setIsSubmitting(true);
    setEngineerError("");
    try {
      const result = await signIn("vitros-role", { role: "engineer" });
      if (result?.signingIn !== true) throw new Error("Sign-in did not complete");
      completeSignIn("engineer");
    } catch {
      setEngineerError("Unable to sign in as Engineer. Please try again.");
    } finally {
      submissionPending.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSuperuserClick = () => {
    if (submissionPending.current) return;
    setShowPassword(true);
    setPassword("");
    setError("");
    setEngineerError("");
  };

  const handlePasswordSubmit = async () => {
    if (submissionPending.current) return;
    if (!password || password.length > 256) {
      setError("Superuser verification failed");
      return;
    }
    submissionPending.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      const result = await signIn("vitros-role", { role: "superuser", secret: password });
      if (result?.signingIn !== true) throw new Error("Sign-in did not complete");
      setShowPassword(false);
      setPassword("");
      completeSignIn("superuser");
    } catch {
      setError("Superuser verification failed");
    } finally {
      submissionPending.current = false;
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
              REM Command Center
            </h1>
            <p className="text-blue-300 text-lg mt-2">Inventory &amp; Remanufacturing</p>
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
                type="button"
                ref={superuserButtonRef}
                onClick={handleSuperuserClick}
                disabled={isSubmitting}
                className="w-full flex items-center gap-5 p-5 rounded-xl bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/25 hover:from-purple-600/30 hover:to-blue-600/30 hover:border-purple-400/40 transition-all duration-200 group disabled:cursor-wait disabled:opacity-60"
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
                type="button"
                ref={engineerButtonRef}
                onClick={() => void handleEngineer()}
                disabled={isSubmitting}
                aria-busy={isSubmitting && !showPassword}
                aria-describedby={engineerError ? "engineer-login-error" : undefined}
                className="w-full flex items-center gap-5 p-5 rounded-xl bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border border-emerald-500/25 hover:from-emerald-600/30 hover:to-teal-600/30 hover:border-emerald-400/40 transition-all duration-200 group disabled:cursor-wait disabled:opacity-60"
              >
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-200">
                  <Wrench className="w-7 h-7 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-bold text-white text-lg">Engineer</p>
                  <p className="text-sm text-emerald-200/70" role={isSubmitting && !showPassword ? "status" : undefined}>
                    {isSubmitting && !showPassword ? "Signing in…" : "Standard access · No password required"}
                  </p>
                </div>
                <div className="text-emerald-400/50 group-hover:text-emerald-300 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
            {engineerError && <p id="engineer-login-error" role="alert" className="text-red-400 text-sm mt-4">{engineerError}</p>}
          </div>

          <Dialog open={showPassword} onOpenChange={(open) => { if (!submissionPending.current) setShowPassword(open); }}>
              <DialogContent
                showCloseButton={false}
                className="block bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] max-w-sm sm:max-w-sm border border-white/10"
                onCloseAutoFocus={(event) => { event.preventDefault(); superuserButtonRef.current?.focus(); }}
                onEscapeKeyDown={(event) => { if (submissionPending.current) event.preventDefault(); }}
                onInteractOutside={(event) => { if (submissionPending.current) event.preventDefault(); }}
              >
                <DialogTitle className="text-lg font-bold text-white mb-4">Enter Superuser Password</DialogTitle>
                <DialogDescription className="sr-only">Verify your superuser access with your password.</DialogDescription>
                <label htmlFor="superuser-password" className="block text-sm text-slate-300 mb-2">Password</label>
                <input
                  id="superuser-password"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "superuser-login-error" : undefined}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.slice(0, 256))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handlePasswordSubmit(); } }}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                  placeholder="Password"
                  autoComplete="current-password"
                  autoFocus
                  disabled={isSubmitting}
                />
                {error && <p id="superuser-login-error" role="alert" className="text-red-400 text-sm mb-3">{error}</p>}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { if (!submissionPending.current) setShowPassword(false); }}
                    className="flex-1 px-4 py-2.5 bg-slate-600 text-white rounded-xl font-semibold hover:bg-slate-500 transition disabled:opacity-50"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePasswordSubmit()}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition disabled:opacity-50"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Verifying…" : "Login"}
                  </button>
                </div>
              </DialogContent>
          </Dialog>

          <div className="text-center mt-8">
            <p className="text-slate-500 text-sm font-medium">QuidelOrtho</p>
            <p className="text-slate-600 text-xs mt-1">Inventory Management · Field Service</p>
          </div>
        </div>
      </div>
    </div>
  );
}
