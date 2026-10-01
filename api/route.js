const crypto = require("node:crypto");
const { admin, db } = require("./_firebase");
const { buildTreatmentAssessmentPdf, pdfSafeName } = require("./_pdf");
const { buildHealthPayload } = require("./_health");

const today = () => new Date().toISOString().slice(0, 10);

const COLLECTIONS = {
  patients: "patients",
  sessions: "sessions",
  appointments: "appointments",
  treatmentAssessments: "treatmentAssessments",
  auth: "appConfig",
  authSessions: "authSessions"
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

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

function safeApiError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("Could not load the default credentials")) {
    return "Credenciais do Firebase não configuradas na Vercel.";
  }
  if (message.includes("The database") || message.includes("NOT_FOUND")) {
    return "Firestore Database não encontrado. Crie o banco no Firebase.";
  }
  if (message.includes("PERMISSION_DENIED") || error?.code === 7) {
    return "A conta de serviço não tem permissão para gravar no Firestore.";
  }
  if (message.includes("DECODER routines") || message.includes("private_key")) {
    return "Chave privada do Firebase inválida. Refaça o Base64 do JSON da conta de serviço.";
  }
  return "Não foi possível concluir a operação. Verifique /api/health e os logs da Vercel.";
}

function publicDebugError(error) {
  const message = String(error?.message || error || "Erro desconhecido");
  return message.slice(0, 500);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function isSecureRequest(req) {
  return process.env.VERCEL === "1" || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(token, req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `gf_session=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=28800`;
}

function clearSessionCookie(req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `gf_session=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const iterations = 160000;
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");
  return { salt, hash, iterations, digest: "sha256" };
}

function verifyPassword(password, auth) {
  if (!auth?.salt || !auth?.hash) return false;
  const nextHash = crypto
    .pbkdf2Sync(String(password), auth.salt, Number(auth.iterations || 160000), 32, auth.digest || "sha256")
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(nextHash, "hex"), Buffer.from(auth.hash, "hex"));
}

async function readAuth() {
  const doc = await db.collection(COLLECTIONS.auth).doc("auth").get();
  return doc.exists ? doc.data() : null;
}

async function writeAuth(auth) {
  await db.collection(COLLECTIONS.auth).doc("auth").set(auth);
}

async function ensureInitialAuth() {
  const auth = await readAuth();
  if (auth) return auth;

  const initialPassword = String(process.env.INITIAL_ADMIN_PASSWORD || "").trim();
  if (!initialPassword) return null;
  if (initialPassword.length < 6) {
    throw new Error("INITIAL_ADMIN_PASSWORD precisa ter pelo menos 6 caracteres.");
  }

  const nextAuth = {
    ...hashPassword(initialPassword),
    createdAt: new Date().toISOString(),
    createdBy: "vercel-env"
  };
  await writeAuth(nextAuth);
  return nextAuth;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function isAuthenticated(req) {
  const token = parseCookies(req).gf_session;
  if (!token) return false;
  const doc = await db.collection(COLLECTIONS.authSessions).doc(token).get();
  if (!doc.exists) return false;
  const expiresAt = doc.data()?.expiresAt?.toMillis?.() || 0;
  if (expiresAt && expiresAt < Date.now()) {
    await doc.ref.delete();
    return false;
  }
  return true;
}

async function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  await db.collection(COLLECTIONS.authSessions).doc(token).set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 8 * 60 * 60 * 1000)
  });
  return token;
}

async function deleteSession(req) {
  const token = parseCookies(req).gf_session;
  if (token) await db.collection(COLLECTIONS.authSessions).doc(token).delete().catch(() => {});
}

function listFromBody(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return [String(value).trim()].filter(Boolean);
}

function yesNoDetails(body, key) {
  return {
    answer: String(body[`${key}Answer`] || "").trim(),
    details: String(body[`${key}Details`] || "").trim()
  };
}

function normalizePatient(body, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || makeId("pac"),
    name: String(body.name || "").trim(),
    phone: String(body.phone || "").trim(),
    birthDate: String(body.birthDate || "").trim(),
    cpf: String(body.cpf || "").trim(),
    occupation: String(body.occupation || "").trim(),
    condition: String(body.condition || "").trim(),
    goals: String(body.goals || "").trim(),
    status: String(body.status || "ativo").trim(),
    therapist: String(body.therapist || "").trim(),
    pain: Number(body.pain || 0),
    frequency: String(body.frequency || "").trim(),
    startedAt: String(body.startedAt || today()).trim(),
    notes: String(body.notes || "").trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function normalizeSession(body, existing = {}) {
  return {
    id: existing.id || makeId("evo"),
    patientId: String(body.patientId || existing.patientId || "").trim(),
    date: String(body.date || today()).trim(),
    pain: Number(body.pain || 0),
    type: String(body.type || "Evolucao").trim(),
    summary: String(body.summary || "").trim(),
    plan: String(body.plan || "").trim()
  };
}

function normalizeAppointment(body, existing = {}) {
  return {
    id: existing.id || makeId("ag"),
    patientId: String(body.patientId || existing.patientId || "").trim(),
    date: String(body.date || today()).trim(),
    time: String(body.time || "08:00").trim(),
    duration: Number(body.duration || 50),
    treatment: String(body.treatment || existing.treatment || "Fisioterapia").trim(),
    status: String(body.status || "agendado").trim(),
    therapist: String(body.therapist || "").trim(),
    room: String(body.room || "").trim(),
    notes: String(body.notes || "").trim()
  };
}

function normalizeTreatmentAssessment(body, existing = {}) {
  if (String(body.assessmentType || body.treatment || "").toLowerCase().includes("geriatric")) {
    return normalizeGeriatricAssessment(body, existing);
  }

  const now = new Date().toISOString();
  return {
    id: existing.id || makeId("trat"),
    patientId: String(body.patientId || existing.patientId || "").trim(),
    treatment: "Limpeza de pele",
    date: String(body.date || today()).trim(),
    sex: String(body.sex || "").trim(),
    health: {
      disease: yesNoDetails(body, "disease"),
      medication: yesNoDetails(body, "medication"),
      allergy: yesNoDetails(body, "allergy"),
      pregnant: String(body.pregnant || "").trim(),
      previousFacialProcedure: yesNoDetails(body, "previousFacialProcedure")
    },
    habits: {
      sunscreen: String(body.sunscreen || "").trim(),
      cleaningFrequency: String(body.cleaningFrequency || "").trim(),
      homeProducts: String(body.homeProducts || "").trim()
    },
    skin: {
      skinTypes: listFromBody(body.skinTypes),
      phototype: String(body.phototype || "").trim(),
      observedConditions: listFromBody(body.observedConditions),
      otherConditions: String(body.otherConditions || "").trim()
    },
    plan: {
      diagnosis: String(body.diagnosis || "").trim(),
      objective: String(body.objective || "").trim(),
      indicatedProcedures: listFromBody(body.indicatedProcedures),
      otherProcedure: String(body.otherProcedure || "").trim(),
      recommendedFrequency: String(body.recommendedFrequency || "").trim(),
      clientGuidance: String(body.clientGuidance || "").trim()
    },
    signatures: {
      client: String(body.clientSignature || "").trim(),
      professional: String(body.professionalSignature || "").trim()
    },
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function normalizeGeriatricAssessment(body, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || makeId("trat"),
    patientId: String(body.patientId || existing.patientId || "").trim(),
    treatment: "Fisioterapia geriatrica",
    date: String(body.date || today()).trim(),
    sex: String(body.sex || "").trim(),
    identification: {
      responsible: String(body.responsible || "").trim()
    },
    complaint: String(body.complaint || "").trim(),
    currentDiseaseHistory: String(body.currentDiseaseHistory || "").trim(),
    history: {
      antecedents: listFromBody(body.antecedents),
      otherAntecedents: String(body.otherAntecedents || "").trim(),
      medicationUse: String(body.medicationUse || "").trim()
    },
    functional: {
      ambulation: String(body.ambulation || "").trim(),
      fallsHistory: String(body.fallsHistory || "").trim(),
      fallsCount: String(body.fallsCount || "").trim(),
      upperStrength: String(body.upperStrength || "").trim(),
      lowerStrength: String(body.lowerStrength || "").trim(),
      rangeOfMotion: String(body.rangeOfMotion || "").trim(),
      rangeLocation: String(body.rangeLocation || "").trim(),
      cognitive: String(body.cognitive || "").trim()
    },
    plan: {
      diagnosis: String(body.physioDiagnosis || body.diagnosis || "").trim(),
      objective: String(body.goals || body.objective || "").trim(),
      treatmentPlan: String(body.treatmentPlan || "").trim(),
      recommendedFrequency: String(body.frequency === "Outro" ? body.frequencyOther || "Outro" : body.frequency || "").trim()
    },
    signatures: {
      professional: String(body.geriatricProfessionalSignature || body.professionalSignature || "").trim()
    },
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

async function listCollection(name) {
  const snapshot = await db.collection(name).get();
  return snapshot.docs.map((doc) => doc.data());
}

async function readState() {
  const [patients, sessions, appointments, treatmentAssessments] = await Promise.all([
    listCollection(COLLECTIONS.patients),
    listCollection(COLLECTIONS.sessions),
    listCollection(COLLECTIONS.appointments),
    listCollection(COLLECTIONS.treatmentAssessments)
  ]);
  return { patients, sessions, appointments, treatmentAssessments };
}

async function handleAuth(req, res, url) {
  const auth = await ensureInitialAuth();

  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    return sendJson(res, 200, {
      configured: Boolean(auth),
      authenticated: Boolean(auth && (await isAuthenticated(req))),
      initialPasswordConfigured: Boolean(process.env.INITIAL_ADMIN_PASSWORD),
      vercelEnvironment: process.env.VERCEL_ENV || "não informado"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/setup") {
    if (auth) return sendJson(res, 409, { error: "A senha já foi configurada." });
    const body = await readBody(req);
    const password = String(body.password || "");
    if (password.length < 6) return sendJson(res, 400, { error: "Use uma senha com pelo menos 6 caracteres." });
    await writeAuth({
      ...hashPassword(password),
      createdAt: new Date().toISOString(),
      createdBy: "setup-screen"
    });
    const token = await createSession();
    return sendJson(res, 201, { ok: true }, { "Set-Cookie": sessionCookie(token, req) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!auth) return sendJson(res, 409, { error: "Crie a senha de acesso primeiro." });
    const body = await readBody(req);
    if (!verifyPassword(body.password || "", auth)) return sendJson(res, 401, { error: "Senha incorreta." });
    const token = await createSession();
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token, req) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await deleteSession(req);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(req) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    if (!auth || !(await isAuthenticated(req))) return sendJson(res, 401, { error: "Faça login para trocar a senha." });
    const body = await readBody(req);
    if (!verifyPassword(body.currentPassword || "", auth)) return sendJson(res, 401, { error: "Senha atual incorreta." });
    if (String(body.newPassword || "").length < 6) return sendJson(res, 400, { error: "Use uma nova senha com pelo menos 6 caracteres." });
    await writeAuth(hashPassword(body.newPassword));
    await deleteSession(req);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(req) });
  }

  return sendJson(res, 404, { error: "Rota de acesso não encontrada." });
}

async function deleteByPatientId(collectionName, patientId) {
  const snapshot = await db.collection(collectionName).where("patientId", "==", patientId).get();
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function handleApi(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      const ref = db.collection("_diagnostics").doc("vercel-route-health");
      await ref.set({
        checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "vercel-route-health"
      });
      await ref.delete();
      return sendJson(res, 200, {
        ok: true,
        runtime: "vercel-route",
        vercelEnvironment: process.env.VERCEL_ENV || "não informado",
        firebaseServiceAccountBase64: hasBase64Credential() ? "configurado" : "não configurado",
        firebaseSplitCredential: hasSplitCredential() ? "configurado" : "não configurado",
        initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD ? "configurado" : "não configurado",
        firestore: { ok: true, write: "ok" }
      });
    } catch (error) {
      return sendJson(res, 500, {
        ok: false,
        runtime: "vercel-route",
        vercelEnvironment: process.env.VERCEL_ENV || "não informado",
        firebaseServiceAccountBase64: hasBase64Credential() ? "configurado" : "não configurado",
        firebaseSplitCredential: hasSplitCredential() ? "configurado" : "não configurado",
        initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD ? "configurado" : "não configurado",
        firestore: {
          ok: false,
          write: "falhou",
          error: publicDebugError(error)
        }
      });
    }
  }

  if (url.pathname.startsWith("/api/auth/")) {
    await handleAuth(req, res, url);
    return;
  }

  const auth = await readAuth();
  if (!auth || !(await isAuthenticated(req))) {
    return sendJson(res, 401, { error: auth ? "Faça login para acessar." : "Crie a senha de acesso primeiro." });
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[1];
  const id = parts[2];

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, await readState());
  }

  if (resource === "patients") {
    if (req.method === "POST") {
      const patient = normalizePatient(await readBody(req));
      if (!patient.name) return sendJson(res, 400, { error: "Informe o nome do paciente." });
      await db.collection(COLLECTIONS.patients).doc(patient.id).set(patient);
      return sendJson(res, 201, patient);
    }

    const ref = db.collection(COLLECTIONS.patients).doc(id || "");
    const doc = await ref.get();
    if (!doc.exists) return sendJson(res, 404, { error: "Paciente não encontrado." });

    if (req.method === "PUT") {
      const patient = normalizePatient(await readBody(req), doc.data());
      if (!patient.name) return sendJson(res, 400, { error: "Informe o nome do paciente." });
      await ref.set(patient);
      return sendJson(res, 200, patient);
    }

    if (req.method === "DELETE") {
      await Promise.all([
        ref.delete(),
        deleteByPatientId(COLLECTIONS.sessions, id),
        deleteByPatientId(COLLECTIONS.appointments, id),
        deleteByPatientId(COLLECTIONS.treatmentAssessments, id)
      ]);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === "sessions") {
    if (req.method === "POST") {
      const session = normalizeSession(await readBody(req));
      if (!session.patientId) return sendJson(res, 400, { error: "Selecione um paciente." });
      await db.collection(COLLECTIONS.sessions).doc(session.id).set(session);
      return sendJson(res, 201, session);
    }

    if (req.method === "DELETE") {
      await db.collection(COLLECTIONS.sessions).doc(id || "").delete();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === "appointments") {
    if (req.method === "POST") {
      const appointment = normalizeAppointment(await readBody(req));
      if (!appointment.patientId) return sendJson(res, 400, { error: "Selecione um paciente." });
      await db.collection(COLLECTIONS.appointments).doc(appointment.id).set(appointment);
      return sendJson(res, 201, appointment);
    }

    const ref = db.collection(COLLECTIONS.appointments).doc(id || "");
    const doc = await ref.get();
    if (!doc.exists) return sendJson(res, 404, { error: "Agendamento não encontrado." });

    if (req.method === "PUT") {
      const appointment = normalizeAppointment(await readBody(req), doc.data());
      await ref.set(appointment);
      return sendJson(res, 200, appointment);
    }

    if (req.method === "DELETE") {
      await ref.delete();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === "treatment-assessments") {
    const ref = db.collection(COLLECTIONS.treatmentAssessments).doc(id || "");

    if (req.method === "POST") {
      const assessment = normalizeTreatmentAssessment(await readBody(req));
      await db.collection(COLLECTIONS.treatmentAssessments).doc(assessment.id).set(assessment);
      return sendJson(res, 201, assessment);
    }

    if (req.method === "GET" && parts[3] === "pdf") {
      const doc = await ref.get();
      if (!doc.exists) return sendJson(res, 404, { error: "Avaliação não encontrada." });
      const assessment = doc.data();
      if (assessment.treatment !== "Limpeza de pele") {
        return sendJson(res, 400, { error: "PDF disponível apenas para limpeza de pele no momento." });
      }
      const patientDoc = assessment.patientId ? await db.collection(COLLECTIONS.patients).doc(assessment.patientId).get() : null;
      const patient = patientDoc?.exists ? patientDoc.data() : {};
      const pdfBuffer = await buildTreatmentAssessmentPdf(assessment, patient);
      const filename = `ficha-limpeza-pele-${pdfSafeName(patient.name)}-${assessment.date || today()}.pdf`;
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.length
      });
      res.end(pdfBuffer);
      return;
    }

    if (req.method === "DELETE") {
      await ref.delete();
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 405, { error: "Operação não suportada." });
}

module.exports = async function handler(req, res) {
  try {
    await handleApi(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: safeApiError(error),
      code: error?.code || "unknown",
      detail: publicDebugError(error)
    });
  }
};
