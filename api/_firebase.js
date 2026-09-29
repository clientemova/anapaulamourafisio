const admin = require("firebase-admin");

function privateKeyFromEnv() {
  return String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

function normalizeServiceAccount(raw) {
  return {
    projectId: raw.projectId || raw.project_id,
    clientEmail: raw.clientEmail || raw.client_email,
    privateKey: String(raw.privateKey || raw.private_key || "").replace(/\\n/g, "\n")
  };
}

function serviceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return normalizeServiceAccount(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")));
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKeyFromEnv()
    };
  }

  return null;
}

function initializeFirebase() {
  if (admin.apps.length) return admin.app();

  const serviceAccount = serviceAccountFromEnv();
  if (serviceAccount) {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.projectId || process.env.FIREBASE_PROJECT_ID
    });
  }

  return admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}

initializeFirebase();

module.exports = {
  admin,
  db: admin.firestore()
};
