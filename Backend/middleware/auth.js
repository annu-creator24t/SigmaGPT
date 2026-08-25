import { getAuth } from "firebase-admin/auth";

// ✅ Middleware — verifies Firebase ID token from frontend (or guest mode)
export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const isGuestHeader = req.headers["x-guest-user"] === "true";

    if (authHeader === "Bearer guest" || isGuestHeader) {
      req.user = {
        uid: "guest_session",
        email: "guest@sigmagpt.local",
        name: "Guest User",
        isGuest: true,
      };
      return next();
    }

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized — no token provided" });
    }

    const idToken = authHeader.split("Bearer ")[1];
    if (idToken === "guest") {
      req.user = {
        uid: "guest_session",
        email: "guest@sigmagpt.local",
        name: "Guest User",
        isGuest: true,
      };
      return next();
    }

    const decodedToken = await getAuth().verifyIdToken(idToken);
    const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS;

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