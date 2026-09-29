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

module.exports = function handler(req, res) {
  const firebaseConfigured = hasBase64Credential() || hasSplitCredential();
  const initialPasswordConfigured = Boolean(process.env.INITIAL_ADMIN_PASSWORD);

  res.writeHead(firebaseConfigured ? 200 : 500, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    ok: firebaseConfigured,
    firebaseServiceAccountBase64: hasBase64Credential() ? "configurado" : "nao configurado",
    firebaseSplitCredential: hasSplitCredential() ? "configurado" : "nao configurado",
    initialAdminPassword: initialPasswordConfigured ? "configurado" : "nao configurado",
    message: firebaseConfigured
      ? "Credenciais do Firebase encontradas na Vercel."
      : "Configure FIREBASE_SERVICE_ACCOUNT_BASE64 na Vercel e faca um novo deploy."
  }));
};
