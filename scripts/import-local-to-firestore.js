const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

function loadDotEnvLocal() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

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

loadDotEnvLocal();

const serviceAccount = serviceAccountFromEnv();
if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.projectId || process.env.FIREBASE_PROJECT_ID
  });
} else {
  admin.initializeApp();
}

const db = admin.firestore();
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data", "pacientes.json");

if (!fs.existsSync(dataPath)) {
  console.error("Arquivo local data/pacientes.json nao encontrado.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const collections = {
  patients: data.patients || [],
  sessions: data.sessions || [],
  appointments: data.appointments || [],
  treatmentAssessments: data.treatmentAssessments || []
};

async function importCollection(name, records) {
  let batch = db.batch();
  let count = 0;

  for (const record of records) {
    if (!record.id) continue;
    batch.set(db.collection(name).doc(record.id), record);
    count += 1;

    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  await batch.commit();
  console.log(`${name}: ${count} registros importados.`);
}

async function main() {
  for (const [name, records] of Object.entries(collections)) {
    await importCollection(name, records);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
