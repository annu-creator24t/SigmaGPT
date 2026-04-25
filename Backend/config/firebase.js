import dotenv from "dotenv";
dotenv.config();

import admin from "firebase-admin";

const hasFirebaseCredentials = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

let db = null;

if (hasFirebaseCredentials) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }

  db = admin.firestore();
} else {
  console.warn("[firebase] Missing service account env vars. Running with in-memory thread store.");
}

export { db, hasFirebaseCredentials };