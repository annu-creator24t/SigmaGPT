import { auth, getIdToken, logOut, onAuthChange } from "./firebase.js";

const GUEST_SESSION_KEY = "sigmagpt.guest.v1";

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const createGuestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `guest_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

const sanitizeGuestId = (value) => String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

export const getGuestSession = () => {
  if (!isBrowser) return null;

  try {
    const raw = window.localStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const id = sanitizeGuestId(parsed?.id);
    if (!id) return null;

    return {
      id,
      name: "Guest",
    };
  } catch {
    return null;
  }
};

const saveGuestSession = (session) => {
  if (!isBrowser) return;
  window.localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
};

export const clearGuestSession = () => {
  if (!isBrowser) return;
  window.localStorage.removeItem(GUEST_SESSION_KEY);
};

export const createGuestUser = (session = getGuestSession()) => {
  if (!session?.id) return null;

  return {
    uid: `guest:${session.id}`,
    displayName: "Guest",
    email: null,
    isGuest: true,
  };
};

export const continueAsGuest = async () => {
  try {
    if (auth?.currentUser) {
      await logOut();
    }
  } catch {
    // Ignore Firebase sign-out errors here; guest mode can still proceed.
  }

  const existing = getGuestSession();
  if (existing) return createGuestUser(existing);

  const nextSession = { id: createGuestId(), name: "Guest" };
  saveGuestSession(nextSession);
  return createGuestUser(nextSession);
};

export const getSessionUser = () => {
  if (auth?.currentUser) return auth.currentUser;
  return createGuestUser();
};

export const onSessionAuthChange = (callback) =>
  onAuthChange((firebaseUser) => {
    if (firebaseUser) {
      clearGuestSession();
      callback(firebaseUser);
      return;
    }

    callback(createGuestUser());
  });

export const signOutCurrentSession = async () => {
  clearGuestSession();

  try {
    await logOut();
  } catch {
    // Firebase may already be signed out; ignore errors.
  }
};

export const getAuthHeaders = async (baseHeaders = {}) => {
  const headers = { ...baseHeaders };
  const token = await getIdToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  const guest = getGuestSession();
  if (guest?.id) {
    headers["X-Auth-Mode"] = "guest";
    headers["X-Guest-Id"] = guest.id;
  }

  return headers;
};
