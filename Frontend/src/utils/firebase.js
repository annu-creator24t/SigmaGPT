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

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ✅ Sign in with Google (email always verified!)
export const signInWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code === "auth/popup-closed-by-user") {
      throw new Error("Sign-in popup was closed before completing.");
    }
    if (err.code === "auth/popup-blocked") {
      throw new Error("Sign-in popup was blocked by browser. Please allow popups.");
    }
    if (err.code === "auth/cancelled-popup-request") {
      return null;
    }
    throw err;
  }
};


// ✅ Sign in with Email/Password
export const signInWithEmail = async (email, password) => {
  const result = await signInWithEmailAndPassword(auth, email, password);

  // ✅ Check email is verified before allowing in
  if (!result.user.emailVerified) {
    await signOut(auth);
    throw { code: "auth/email-not-verified" };
  }

  return result;
};

// ✅ Register — sends verification email automatically
export const registerWithEmail = async (email, password) => {
  const result = await createUserWithEmailAndPassword(auth, email, password);

  // ✅ Send verification email immediately
  await sendEmailVerification(result.user);

  // ✅ Sign out until they verify
  await signOut(auth);

  return result;
};

// ✅ Resend verification email
export const resendVerificationEmail = async (email, password) => {
  const result = await signInWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(result.user);
  await signOut(auth);
};

// ✅ Sign out
export const logOut = () => signOut(auth);

// ✅ Get current user's ID token
export const getIdToken = async () => {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(true); // force refresh
};

// ✅ Listen to auth state
export const onAuthChange = (callback) => onAuthStateChanged(auth, callback);

export default app;