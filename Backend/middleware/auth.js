import { getAuth } from "firebase-admin/auth";

const normalizeGuestId = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);

// ✅ Middleware — allows either Firebase token auth or guest session auth
export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const guestModeHeader = String(req.headers["x-auth-mode"] || "").toLowerCase();
    const guestId = normalizeGuestId(req.headers["x-guest-id"]);

    if (guestModeHeader === "guest" || guestId) {
      if (!guestId) {
        return res.status(401).json({ error: "Unauthorized — invalid guest session" });
      }

      req.user = {
        uid: `guest:${guestId}`,
        email: null,
        name: "Guest",
        isGuest: true,
      };

      return next();
    }

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized — no token provided" });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await getAuth().verifyIdToken(idToken);

    const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS; // e.g. "gmail.com"
    if (allowedDomains && allowedDomains !== "*") {
      const emailDomain = decodedToken.email?.split("@")[1];
      if (!allowedDomains.split(",").includes(emailDomain)) {
        return res.status(403).json({ error: "Access restricted" });
      }
    }

    // ✅ Attach user info to request
    req.user = {
      uid:   decodedToken.uid,
      email: decodedToken.email,
      name:  decodedToken.name || decodedToken.email,
      isGuest: false,
    };

    next();
  } catch (err) {
    console.error("❌ Auth error:", err.message);
    return res.status(401).json({ error: "Unauthorized — invalid token" });
  }
};