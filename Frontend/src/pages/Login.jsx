import { useState } from "react";
import "./Login.css";
import {
  signInWithGoogle,
  signInWithEmail,
  registerWithEmail,
  resendVerificationEmail,
} from "../utils/firebase.js";


function Login({ onContinueAsGuest }) {
  const [isRegister, setIsRegister]         = useState(false);
  const [email, setEmail]                   = useState("");
  const [password, setPassword]             = useState("");
  const [error, setError]                   = useState("");
  const [loading, setLoading]               = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resending, setResending]           = useState(false);

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError("Google sign-in failed. Try again.");
    }
    setLoading(false);
  };

  const handleContinueAsGuest = async () => {
    setError("");
    setLoading(true);
    try {
      await onContinueAsGuest?.();
    } catch {
      setError("Unable to continue as guest. Try again.");
    }
    setLoading(false);
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) { setError("Please fill in all fields."); return; }
    if (password.length < 6)  { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    try {
      if (isRegister) {
        await registerWithEmail(email, password);
        setVerificationSent(true); // ✅ Show verification message
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err) {
      const messages = {
        "auth/user-not-found":      "No account found with this email.",
        "auth/wrong-password":      "Incorrect password.",
        "auth/email-already-in-use":"Email already in use.",
        "auth/invalid-email":       "Invalid email address.",
        "auth/too-many-requests":   "Too many attempts. Try again later.",
        "auth/invalid-credential":  "Invalid email or password.",
        "auth/email-not-verified":  "Please verify your email before signing in. Check your inbox!",
      };
      setError(messages[err.code] || "Authentication failed. Try again.");
    }
    setLoading(false);
  };

  const handleResend = async () => {
    if (!email || !password) { setError("Enter your email and password to resend."); return; }
    setResending(true);
    try {
      await resendVerificationEmail(email, password);
      toast && toast.success("Verification email sent!");
      setError("");
    } catch {
      setError("Failed to resend. Try again.");
    }
    setResending(false);
  };

  // ✅ Verification sent screen
  if (verificationSent) {
    return (
      <div className="loginPage">
        <div className="loginCard">
          <div className="verifyIcon">📧</div>
          <h2 className="verifyTitle">Check your email!</h2>
          <p className="verifyText">
            We sent a verification link to <strong>{email}</strong>.
            Click the link in the email to activate your account.
          </p>
          <p className="verifyNote">
            After verifying, come back and sign in.
          </p>
          <button
            className="loginBtn"
            onClick={() => { setVerificationSent(false); setIsRegister(false); }}
          >
            Back to Sign In
          </button>
          <button
            className="resendBtn"
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? "Sending..." : "Resend verification email"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="loginPage">
      <div className="loginCard">
        {/* Logo */}
        <div className="loginLogo">
          <span className="loginSigma">Σ</span>
          <span className="loginName">igmaGPT</span>
        </div>

        <p className="loginTagline">Your intelligent AI assistant</p>

        {/* Google button */}
        <button className="googleBtn" onClick={handleGoogle} disabled={loading}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
          Continue with Google
        </button>

        <button type="button" className="guestBtn" onClick={handleContinueAsGuest} disabled={loading}>
          Continue as Guest
        </button>

        <div className="loginDivider"><span>or</span></div>

        {/* Email form */}
        <form onSubmit={handleEmailAuth} className="loginForm">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="loginInput"
            disabled={loading}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="loginInput"
            disabled={loading}
          />

          {error && (
            <div className="loginErrorBox">
              <p className="loginError">{error}</p>
              {/* Show resend button if email not verified */}
              {error.includes("verify") && (
                <button
                  type="button"
                  className="resendBtn"
                  onClick={handleResend}
                  disabled={resending}
                >
                  {resending ? "Sending..." : "Resend verification email"}
                </button>
              )}
            </div>
          )}

          <button type="submit" className="loginBtn" disabled={loading}>
            {loading ? "Please wait..." : isRegister ? "Create Account" : "Sign In"}
          </button>
        </form>

        {/* Toggle */}
        <p className="loginToggle">
          {isRegister ? "Already have an account?" : "Don't have an account?"}
          <button onClick={() => { setIsRegister(!isRegister); setError(""); }}>
            {isRegister ? "Sign In" : "Create Account"}
          </button>
        </p>

        <p className="loginFooter">Powered by Groq ⚡ · Free forever</p>
      </div>
    </div>
  );
}

export default Login;