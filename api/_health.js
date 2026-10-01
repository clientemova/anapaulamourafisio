function hasBase64Credential() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);
}

function hasSplitCredential() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

function safeError(error) {
  return {
    code: error?.code || "unknown",
    message: String(error?.message || error || "Erro desconhecido").slice(0, 400)
  };
}

async function testFirestore() {
  try {
    const { admin, db } = require("./_firebase");
    const ref = db.collection("_diagnostics").doc("vercel-health");
    await ref.set({
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "vercel-health"
    });
    await ref.delete();
    return { ok: true, write: "ok" };
  } catch (error) {
    return { ok: false, write: "falhou", error: safeError(error) };
  }
}

async function buildHealthPayload() {
  const firebaseConfigured = hasBase64Credential() || hasSplitCredential();
  const initialPasswordConfigured = Boolean(process.env.INITIAL_ADMIN_PASSWORD);
  const firestore = firebaseConfigured
    ? await testFirestore()
    : { ok: false, write: "nao testado" };
  const ok = firebaseConfigured && firestore.ok;

  return {
    ok,
    firebaseServiceAccountBase64: hasBase64Credential() ? "configurado" : "nao configurado",
    firebaseSplitCredential: hasSplitCredential() ? "configurado" : "nao configurado",
    initialAdminPassword: initialPasswordConfigured ? "configurado" : "nao configurado",
    firestore,
    message: ok
      ? "Firebase e Firestore funcionando na Vercel."
      : "A Vercel ainda nao conseguiu gravar no Firestore. Confira credenciais, permissao da conta de servico e se o Firestore Database foi criado."
  };
}

module.exports = { buildHealthPayload };
