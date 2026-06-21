import admin from "firebase-admin";
import { env } from "./env.mjs";

let firebaseAdminApp;

export function getFirebaseAdmin() {
  if (!firebaseAdminApp) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      firebaseAdminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      // Fallback for environment variables if preferred
      firebaseAdminApp = admin.initializeApp({
        projectId: env.firebaseProjectId || process.env.VITE_FIREBASE_PROJECT_ID,
      });
    }
  }
  return admin;
}

export async function verifyFirebaseToken(idToken) {
  const firebaseAdmin = getFirebaseAdmin();
  return firebaseAdmin.auth().verifyIdToken(idToken);
}
