import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  reload,
} from "firebase/auth";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

let app = null;
let auth = null;
let googleProvider = null;

if (hasFirebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
} else {
  console.warn("[firebase] Missing VITE_FIREBASE_* config. Firebase auth is disabled.");
}

const requireAuth = () => {
  if (!auth) {
    const err = new Error("Firebase auth is not configured");
    err.code = "auth/unavailable";
    throw err;
  }
  return auth;
};

export { app, auth, googleProvider };

// ✅ Sign in with Google (email always verified!)
export const signInWithGoogle = () => signInWithPopup(requireAuth(), googleProvider);

// ✅ Sign in with Email/Password
export const signInWithEmail = async (email, password) => {
  const activeAuth = requireAuth();
  const result = await signInWithEmailAndPassword(activeAuth, email, password);

  // ✅ Check email is verified before allowing in
  if (!result.user.emailVerified) {
    await signOut(activeAuth);
    throw { code: "auth/email-not-verified" };
  }

  return result;
};

// ✅ Register — sends verification email automatically
export const registerWithEmail = async (email, password) => {
  const activeAuth = requireAuth();
  const result = await createUserWithEmailAndPassword(activeAuth, email, password);

  // ✅ Send verification email immediately
  await sendEmailVerification(result.user);

  // ✅ Sign out until they verify
  await signOut(activeAuth);

  return result;
};

// ✅ Resend verification email
export const resendVerificationEmail = async (email, password) => {
  const activeAuth = requireAuth();
  const result = await signInWithEmailAndPassword(activeAuth, email, password);
  await sendEmailVerification(result.user);
  await signOut(activeAuth);
};

// ✅ Sign out
export const logOut = async () => {
  if (!auth) return;
  await signOut(auth);
};

// ✅ Get current user's ID token
export const getIdToken = async () => {
  const user = auth?.currentUser;
  if (!user) return null;
  return user.getIdToken(true); // force refresh
};

// ✅ Listen to auth state
export const onAuthChange = (callback) => {
  if (!auth) {
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, callback);
};

export default app;