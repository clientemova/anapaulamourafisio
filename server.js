const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const root = __dirname;
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "pacientes.json");
const authPath = path.join(dataDir, "auth.json");
const activeSessions = new Set();

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const port = Number(process.env.PORT || getArg("port", "3080"));
const host = process.env.HOST || getArg("host", "127.0.0.1");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

const today = new Date().toISOString().slice(0, 10);

const starterData = {
  patients: [
    {
      id: "pac_ana",
      name: "Ana Ribeiro",
      phone: "(11) 98888-1122",
      birthDate: "1987-04-18",
      cpf: "",
      occupation: "Professora",
      condition: "Lombalgia cronica",
      goals: "Reduzir dor lombar, retomar caminhadas e melhorar mobilidade.",
      status: "ativo",
      therapist: "Dra. Paula",
      pain: 6,
      frequency: "2x por semana",
      startedAt: "2026-09-02",
      notes: "Evitar flexao sustentada nas primeiras semanas.",
      createdAt: "2026-09-02T12:00:00.000Z",
      updatedAt: "2026-09-12T12:00:00.000Z"
    },
    {
      id: "pac_carlos",
      name: "Carlos Martins",
      phone: "(11) 97777-5533",
      birthDate: "1974-11-03",
      cpf: "",
      occupation: "Motorista",
      condition: "Reabilitacao pos-operatoria de joelho",
      goals: "Ganhar amplitude, fortalecer quadriceps e voltar ao trabalho.",
      status: "ativo",
      therapist: "Dr. Marcos",
      pain: 4,
      frequency: "3x por semana",
      startedAt: "2026-08-21",
      notes: "Acompanhar edema e tolerancia a carga.",
      createdAt: "2026-08-21T12:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z"
    },
    {
      id: "pac_beatriz",
      name: "Beatriz Lima",
      phone: "(11) 96666-0099",
      birthDate: "1996-02-27",
      cpf: "",
      occupation: "Designer",
      condition: "Cervicalgia por postura",
      goals: "Diminuir cefaleia, ajustar ergonomia e fortalecer cintura escapular.",
      status: "alta",
      therapist: "Dra. Paula",
      pain: 1,
      frequency: "Manutencao mensal",
      startedAt: "2026-07-05",
      notes: "Recebeu plano domiciliar.",
      createdAt: "2026-07-05T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z"
    }
  ],
  sessions: [
    {
      id: "evo_1",
      patientId: "pac_ana",
      date: "2026-09-09",
      pain: 5,
      type: "Evolucao",
      summary: "Melhora da mobilidade lombar. Tolerou ponte e estabilizacao em decubito.",
      plan: "Progredir controle motor e caminhada leve."
    },
    {
      id: "evo_2",
      patientId: "pac_carlos",
      date: "2026-09-13",
      pain: 4,
      type: "Reavaliação",
      summary: "Flexao de joelho chegou a 105 graus. Edema discreto no fim da tarde.",
      plan: "Manter crioterapia apos treino e aumentar carga gradualmente."
    }
  ],
  appointments: [
    {
      id: "ag_1",
      patientId: "pac_ana",
      date: today,
      time: "09:00",
      duration: 50,
      status: "confirmado",
      therapist: "Dra. Paula",
      room: "Sala 1",
      notes: "Sessao de analgesia e estabilizacao."
    },
    {
      id: "ag_2",
      patientId: "pac_carlos",
      date: today,
      time: "10:30",
      duration: 60,
      status: "agendado",
      therapist: "Dr. Marcos",
      room: "Sala 2",
      notes: "Fortalecimento e treino de marcha."
    }
  ],
  treatmentAssessments: []
};

async function ensureDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    await writeDb(starterData);
  }
}

async function readAuth() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const text = await fs.readFile(authPath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeAuth(auth) {
  const tempPath = `${authPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(auth, null, 2), "utf8");
  await fs.rename(tempPath, authPath);
}

async function readDb() {
  await ensureDb();
  const text = await fs.readFile(dbPath, "utf8");
  const data = JSON.parse(text);
  data.patients = data.patients || [];
  data.sessions = data.sessions || [];
  data.appointments = data.appointments || [];
  data.treatmentAssessments = data.treatmentAssessments || [];
  return data;
}

async function writeDb(data) {
  const tempPath = `${dbPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, dbPath);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendJsonWithHeaders(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function publicDebugError(error) {
  return String(error?.message || error || "Erro desconhecido").slice(0, 500);
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function firstMatch(text, pattern) {
  return text.match(pattern)?.[1] || "";
}

function parseFeedLinks(html) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    links.push({
      url: decodeEntities(match[1]),
      label: decodeXml(match[2])
    });
  }
  return links;
}

function extractVerseFromHtml(html) {
  const candidates = [
    /<div[^>]+class=["'][^"']*(?:jss\d+\s+)?versiculo[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]+class=["'][^"']*versiculo[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    /<span[^>]+class=["'][^"']*texto[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i
  ];

  for (const pattern of candidates) {
    const text = decodeXml(firstMatch(html, pattern));
    if (text.length > 25 && text.length < 600) return text;
  }

  const meta = firstMatch(html, /<meta[^>]+(?:property|name)=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const metaText = decodeXml(meta);
  return metaText.length > 25 ? metaText : "";
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { timeout: 8000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(fetchText(new URL(response.headers.location, url).toString()));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Feed respondeu com status ${response.statusCode}.`));
        return;
      }

      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => resolve(data));
    });

    request.on("timeout", () => {
      request.destroy(new Error("Tempo esgotado ao buscar o versículo."));
    });
    request.on("error", reject);
  });
}

async function readDailyVerse() {
  const feed = await fetchText("http://ie6.bibliaonline.com.br/acf/feeds/daily_verses.atom");
  const entry = firstMatch(feed, /<entry\b[^>]*>([\s\S]*?)<\/entry>/i) || feed;
  const title = decodeXml(firstMatch(entry, /<title\b[^>]*>([\s\S]*?)<\/title>/i));
  const rawContent = firstMatch(entry, /<content\b[^>]*>([\s\S]*?)<\/content>/i) ||
    firstMatch(entry, /<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  const contentHtml = decodeEntities(rawContent);
  const links = parseFeedLinks(contentHtml);
  const selected = links.find((link) => /\/acf\/[^/]+\/\d+\/\d+/i.test(link.url)) || links[0];
  const content = decodeXml(
    firstMatch(entry, /<content\b[^>]*>([\s\S]*?)<\/content>/i) ||
    firstMatch(entry, /<summary\b[^>]*>([\s\S]*?)<\/summary>/i)
  );

  if (selected?.url) {
    try {
      const page = await fetchText(selected.url);
      const verseText = extractVerseFromHtml(page);
      if (verseText) {
        return {
          text: verseText,
          reference: selected.label || title || "Bíblia Online",
          source: selected.url
        };
      }
    } catch {
      return {
        text: selected.label || content || title || "Versículo indisponível no momento.",
        reference: "Bíblia Online",
        source: selected.url
      };
    }
  }

  return {
    text: content || title || "Versículo indisponível no momento.",
    reference: title && content && title !== content ? title : "Bíblia Online",
    source: "http://ie6.bibliaonline.com.br/acf/feeds/daily_verses.atom"
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

function isAuthenticated(req) {
  const token = parseCookies(req).gf_session;
  return Boolean(token && activeSessions.has(token));
}

function sessionCookie(token) {
  return `gf_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
}

function clearSessionCookie() {
  return "gf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

async function handleAuth(req, res, url) {
  const auth = await readAuth();

  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    return sendJson(res, 200, { configured: Boolean(auth), authenticated: Boolean(auth && isAuthenticated(req)) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/setup") {
    if (auth) return sendJson(res, 409, { error: "A senha ja foi configurada." });
    const body = await readBody(req);
    const password = String(body.password || "");
    if (password.length < 6) return sendJson(res, 400, { error: "Use uma senha com pelo menos 6 caracteres." });
    await writeAuth(hashPassword(password));
    const token = crypto.randomBytes(32).toString("hex");
    activeSessions.add(token);
    return sendJsonWithHeaders(res, 201, { ok: true }, { "Set-Cookie": sessionCookie(token) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!auth) return sendJson(res, 409, { error: "Crie a senha de acesso primeiro." });
    const body = await readBody(req);
    if (!verifyPassword(body.password || "", auth)) {
      return sendJson(res, 401, { error: "Senha incorreta." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    activeSessions.add(token);
    return sendJsonWithHeaders(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req).gf_session;
    if (token) activeSessions.delete(token);
    return sendJsonWithHeaders(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    if (!auth || !isAuthenticated(req)) return sendJson(res, 401, { error: "Faça login para trocar a senha." });
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!verifyPassword(currentPassword, auth)) return sendJson(res, 401, { error: "Senha atual incorreta." });
    if (newPassword.length < 6) return sendJson(res, 400, { error: "Use uma nova senha com pelo menos 6 caracteres." });
    await writeAuth(hashPassword(newPassword));
    activeSessions.clear();
    return sendJsonWithHeaders(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
  }

  return sendJson(res, 404, { error: "Rota de acesso não encontrada." });
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
    startedAt: String(body.startedAt || today).trim(),
    notes: String(body.notes || "").trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function normalizeSession(body, existing = {}) {
  return {
    id: existing.id || makeId("evo"),
    patientId: String(body.patientId || existing.patientId || "").trim(),
    date: String(body.date || today).trim(),
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
    date: String(body.date || today).trim(),
    time: String(body.time || "08:00").trim(),
    duration: Number(body.duration || 50),
    treatment: String(body.treatment || existing.treatment || "Fisioterapia").trim(),
    status: String(body.status || "agendado").trim(),
    therapist: String(body.therapist || "").trim(),
    room: String(body.room || "").trim(),
    notes: String(body.notes || "").trim()
  };
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

function normalizeTreatmentAssessment(body, existing = {}) {
  if (String(body.assessmentType || body.treatment || "").toLowerCase().includes("geriatric")) {
    return normalizeGeriatricAssessment(body, existing);
  }

  const now = new Date().toISOString();
  return {
    id: existing.id || makeId("trat"),
    patientId: String(body.patientId || existing.patientId || "").trim(),
    treatment: "Limpeza de pele",
    date: String(body.date || today).trim(),
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
    date: String(body.date || today).trim(),
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

function removeAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}

function pdfEscape(value) {
  return removeAccents(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfSafeName(value) {
  return removeAccents(value || "paciente")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "paciente";
}

function formatDatePt(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function calculateAgePt(value) {
  if (!value) return "-";
  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "-";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return `${age} anos`;
}

function listTextPdf(items, fallback = "-") {
  const values = (items || []).filter(Boolean);
  return values.length ? values.join(", ") : fallback;
}

function isGeriatricTreatment(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes("geriatrica");
}

function yesNoTextPdf(item) {
  if (!item?.answer && !item?.details) return "-";
  return [item.answer, item.details].filter(Boolean).join(" - ");
}

function wrapText(value, maxWidth, fontSize) {
  const words = removeAccents(value || "-").replace(/\s+/g, " ").trim().split(" ");
  const maxChars = Math.max(12, Math.floor(maxWidth / (fontSize * 0.52)));
  const lines = [];
  let line = "";

  for (const word of words) {
    if (!word) continue;
    if (word.length > maxChars) {
      if (line) lines.push(line);
      for (let index = 0; index < word.length; index += maxChars) lines.push(word.slice(index, index + maxChars));
      line = "";
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function parsePng(buffer) {
  if (!buffer || buffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Imagem PNG inválida.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const chunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString("ascii");
    const data = buffer.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Formato de logo PNG não suportado.");
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(chunks));
  const raw = Buffer.alloc(width * height * bytesPerPixel);
  let sourceOffset = 0;
  let targetOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(inflated.slice(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;

    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previous[index] || 0;
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0;
      if (filter === 1) row[index] = (row[index] + left) & 255;
      else if (filter === 2) row[index] = (row[index] + up) & 255;
      else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error("Filtro PNG não suportado.");
    }

    row.copy(raw, targetOffset);
    targetOffset += stride;
    previous = row;
  }

  if (colorType === 2) return { width, height, rgb: raw, alpha: null };

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height);
  for (let source = 0, rgbIndex = 0, alphaIndex = 0; source < raw.length; source += 4) {
    rgb[rgbIndex++] = raw[source];
    rgb[rgbIndex++] = raw[source + 1];
    rgb[rgbIndex++] = raw[source + 2];
    alpha[alphaIndex++] = raw[source + 3];
  }

  return { width, height, rgb, alpha };
}

function parsePngDataUrl(value) {
  const match = String(value || "").match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  try {
    return parsePng(Buffer.from(match[1], "base64"));
  } catch {
    return null;
  }
}

class PdfDocument {
  constructor() {
    this.objects = [];
  }

  reserveObject() {
    this.objects.push(null);
    return this.objects.length;
  }

  setObject(id, content) {
    this.objects[id - 1] = content;
  }

  addObject(content) {
    this.objects.push(content);
    return this.objects.length;
  }

  addStream(dictionary, buffer) {
    return this.addObject([
      Buffer.from(`${dictionary} /Length ${buffer.length} >>\nstream\n`, "binary"),
      buffer,
      Buffer.from("\nendstream", "binary")
    ]);
  }

  build(rootId) {
    const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary")];
    const offsets = [0];
    let size = chunks[0].length;

    this.objects.forEach((object, index) => {
      if (!object) throw new Error(`Objeto PDF ${index + 1} vazio.`);
      offsets[index + 1] = size;
      const header = Buffer.from(`${index + 1} 0 obj\n`, "binary");
      const body = Array.isArray(object) ? Buffer.concat(object.map((item) => Buffer.isBuffer(item) ? item : Buffer.from(String(item), "binary"))) : Buffer.from(String(object), "binary");
      const footer = Buffer.from("\nendobj\n", "binary");
      chunks.push(header, body, footer);
      size += header.length + body.length + footer.length;
    });

    const xrefOffset = size;
    const xref = [
      "xref",
      `0 ${this.objects.length + 1}`,
      "0000000000 65535 f ",
      ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
      "trailer",
      `<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R >>`,
      "startxref",
      String(xrefOffset),
      "%%EOF"
    ].join("\n");
    chunks.push(Buffer.from(xref, "binary"));
    return Buffer.concat(chunks);
  }
}

function addPngImage(pdf, image) {
  if (!image) return null;
  const alphaId = image.alpha
    ? pdf.addStream(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        zlib.deflateSync(image.alpha)
      )
    : null;
  const mask = alphaId ? ` /SMask ${alphaId} 0 R` : "";
  const imageId = pdf.addStream(
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${mask}`,
    zlib.deflateSync(image.rgb)
  );
  return { id: imageId, width: image.width, height: image.height };
}

async function buildTreatmentAssessmentPdf(assessment, patient) {
  const pdf = new PdfDocument();
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const brandText = "Dra. Ana Paula - Fisioterapeuta";

  const fontId = pdf.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = pdf.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const logoImage = addPngImage(pdf, parsePng(await fs.readFile(path.join(publicDir, "logo-sistema-v2.png"))));
  const clientSignature = addPngImage(pdf, parsePngDataUrl(assessment.signatures?.client));
  const professionalSignature = addPngImage(pdf, parsePngDataUrl(assessment.signatures?.professional));
  const xObjects = [
    `/Logo ${logoImage.id} 0 R`,
    clientSignature ? `/ClientSignature ${clientSignature.id} 0 R` : "",
    professionalSignature ? `/ProfessionalSignature ${professionalSignature.id} 0 R` : ""
  ].filter(Boolean).join(" ");

  const pagesId = pdf.reserveObject();
  const pageIds = [];
  let content = [];
  let y = 754;

  const text = (value, x, yPosition, size = 10, bold = false, color = "0.08 0.14 0.15") => {
    content.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${yPosition.toFixed(2)} Td (${pdfEscape(value)}) Tj ET`);
  };
  const line = (x1, y1, x2, y2, color = "0.78 0.84 0.85") => {
    content.push(`${color} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };
  const rect = (x, yPosition, width, height, color = "0.72 0.78 0.79") => {
    content.push(`${color} RG ${x.toFixed(2)} ${yPosition.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  };
  const fillRect = (x, yPosition, width, height, color = "0.25 0.56 0.62") => {
    content.push(`${color} rg ${x.toFixed(2)} ${yPosition.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  };
  const image = (name, x, yPosition, width, height) => {
    content.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${yPosition.toFixed(2)} cm /${name} Do Q`);
  };

  const drawBrand = () => {
    image("Logo", margin, pageHeight - 61, 26, 26);
    text(brandText, margin + 34, pageHeight - 46, 11, true);
    image("Logo", margin, 24, 16, 16);
    text(brandText, margin + 23, 29, 9, false, "0.22 0.31 0.33");
  };

  const finishPage = () => {
    drawBrand();
    const stream = Buffer.from(content.join("\n"), "binary");
    const contentId = pdf.addStream("<< /Filter /FlateDecode", zlib.deflateSync(stream));
    const pageId = pdf.addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> /XObject << ${xObjects} >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
    content = [];
    y = 754;
  };

  const ensureSpace = (height) => {
    if (y - height >= 70) return;
    finishPage();
  };

  const section = (title) => {
    ensureSpace(24);
    y -= 17;
    fillRect(margin, y, pageWidth - margin * 2, 12);
    text(title, margin + 6, y + 3, 7.8, true, "1 1 1");
    y -= 3;
  };

  const prepareField = (label, value, width) => {
    const lines = wrapText(value || "-", width - 12, 7.8);
    return {
      label,
      lines,
      height: Math.max(24, 16 + lines.length * 8.2)
    };
  };

  const drawFieldBox = (fieldInfo, x, yPosition, width, height) => {
    rect(x, yPosition, width, height, "0.75 0.82 0.83");
    text(String(fieldInfo.label).toUpperCase(), x + 5, yPosition + height - 9, 5.8, true, "0.37 0.45 0.47");
    fieldInfo.lines.forEach((item, index) => {
      text(item, x + 5, yPosition + height - 17 - index * 8.2, 7.8);
    });
  };

  const fieldRow = (items, columns = items.length) => {
    const gap = 5;
    const available = pageWidth - margin * 2;
    const width = (available - gap * (columns - 1)) / columns;
    const prepared = items.map((item) => prepareField(item.label, item.value, width));
    const rowHeight = Math.max(...prepared.map((item) => item.height));
    ensureSpace(rowHeight + 5);
    y -= rowHeight;
    prepared.forEach((item, index) => {
      drawFieldBox(item, margin + index * (width + gap), y, width, rowHeight);
    });
    y -= 3;
  };

  const field = (label, value) => {
    const width = pageWidth - margin * 2;
    const fieldInfo = prepareField(label, value, width);
    ensureSpace(fieldInfo.height + 5);
    y -= fieldInfo.height;
    drawFieldBox(fieldInfo, margin, y, width, fieldInfo.height);
    y -= 3;
  };

  const signature = (label, imageName, imageObject, x) => {
    const width = (pageWidth - margin * 2 - 14) / 2;
    const height = 66;
    rect(x, y, width, height);
    line(x + 12, y + 20, x + width - 12, y + 20, "0.12 0.12 0.12");
    text(label, x + 12, y + 8, 7.6);
    if (imageObject) {
      const maxWidth = width - 34;
      const maxHeight = 30;
      const scale = Math.min(maxWidth / imageObject.width, maxHeight / imageObject.height);
      const drawWidth = imageObject.width * scale;
      const drawHeight = imageObject.height * scale;
      image(imageName, x + (width - drawWidth) / 2, y + 25, drawWidth, drawHeight);
    }
  };

  if (isGeriatricTreatment(assessment.treatment)) {
    text("Ficha de avaliacao - Fisioterapia geriatrica", margin, y, 14, true);
    y -= 14;
    text(`Gerada em ${formatDatePt(today)}`, margin, y, 8.5, false, "0.37 0.45 0.47");

    section("Dados do paciente");
    field("Nome", patient.name || "Sem paciente vinculado");
    fieldRow([
      { label: "Data da avaliacao", value: formatDatePt(assessment.date) },
      { label: "Nascimento", value: formatDatePt(patient.birthDate) },
      { label: "Idade", value: calculateAgePt(patient.birthDate) }
    ], 3);
    fieldRow([
      { label: "Sexo", value: assessment.sex || "-" },
      { label: "Telefone", value: patient.phone || "-" },
      { label: "Responsavel", value: assessment.identification?.responsible || "-" }
    ], 3);

    section("Queixa e historia");
    field("Queixa principal", assessment.complaint || "-");
    field("Historia da doenca atual", assessment.currentDiseaseHistory || "-");

    section("Antecedentes e medicamentos");
    field("Antecedentes", listTextPdf([...(assessment.history?.antecedents || []), assessment.history?.otherAntecedents].filter(Boolean)));
    field("Medicamentos em uso", assessment.history?.medicationUse || "-");

    section("Avaliacao funcional");
    fieldRow([
      { label: "Deambulacao", value: assessment.functional?.ambulation || "-" },
      { label: "Historico de quedas", value: assessment.functional?.fallsHistory || "-" },
      { label: "Numero de quedas", value: assessment.functional?.fallsCount || "-" }
    ], 3);
    fieldRow([
      { label: "Forca MMSS", value: assessment.functional?.upperStrength || "-" },
      { label: "Forca MMII", value: assessment.functional?.lowerStrength || "-" },
      { label: "Cognicao", value: assessment.functional?.cognitive || "-" }
    ], 3);
    fieldRow([
      { label: "Amplitude de movimento", value: assessment.functional?.rangeOfMotion || "-" },
      { label: "Local", value: assessment.functional?.rangeLocation || "-" }
    ], 2);

    section("Diagnostico e plano");
    field("Diagnostico fisioterapeutico", assessment.plan?.diagnosis || "-");
    field("Objetivo", assessment.plan?.objective || "-");
    field("Plano terapeutico", assessment.plan?.treatmentPlan || "-");
    field("Frequencia recomendada", assessment.plan?.recommendedFrequency || "-");

    section("Assinatura");
    ensureSpace(78);
    y -= 66;
    signature("Assinatura do profissional", "ProfessionalSignature", professionalSignature, margin);

    finishPage();
    pdf.setObject(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    const catalogId = pdf.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    return pdf.build(catalogId);
  }

  text("Ficha de avaliação - Limpeza de pele", margin, y, 14, true);
  y -= 14;
  text(`Gerada em ${formatDatePt(today)}`, margin, y, 8.5, false, "0.37 0.45 0.47");

  section("Identificacao pessoal");
  field("Nome", patient.name || "Sem paciente vinculado");
  fieldRow([
    { label: "Data da avaliação", value: formatDatePt(assessment.date) },
    { label: "Nascimento", value: formatDatePt(patient.birthDate) },
    { label: "Idade", value: calculateAgePt(patient.birthDate) }
  ], 3);
  fieldRow([
    { label: "Sexo", value: assessment.sex || "-" },
    { label: "Profissao", value: patient.occupation || "-" },
    { label: "Telefone", value: patient.phone || "-" }
  ], 3);

  section("Historico de saude");
  fieldRow([
    { label: "Possui alguma doenca?", value: yesNoTextPdf(assessment.health?.disease) },
    { label: "Medicamentos continuos", value: yesNoTextPdf(assessment.health?.medication) }
  ], 2);
  fieldRow([
    { label: "Alergias", value: yesNoTextPdf(assessment.health?.allergy) },
    { label: "Gestante", value: assessment.health?.pregnant || "-" }
  ], 2);
  field("Procedimentos estéticos faciais", yesNoTextPdf(assessment.health?.previousFacialProcedure));

  section("Habitos e rotina de cuidados");
  fieldRow([
    { label: "Usa protetor solar diariamente?", value: assessment.habits?.sunscreen || "-" },
    { label: "Frequência de limpeza facial", value: assessment.habits?.cleaningFrequency || "-" }
  ], 2);
  field("Produtos que utiliza em casa", assessment.habits?.homeProducts || "-");

  section("Avaliação da pele");
  fieldRow([
    { label: "Tipo de pele", value: listTextPdf(assessment.skin?.skinTypes) },
    { label: "Fototipo", value: assessment.skin?.phototype || "-" }
  ], 2);
  fieldRow([
    { label: "Condições observadas", value: listTextPdf(assessment.skin?.observedConditions) },
    { label: "Outros", value: assessment.skin?.otherConditions || "-" }
  ], 2);

  section("Plano do tratamento");
  field("Diagnostico estético", assessment.plan?.diagnosis || "-");
  field("Objetivo do tratamento", assessment.plan?.objective || "-");
  fieldRow([
    { label: "Procedimento indicado", value: listTextPdf([...(assessment.plan?.indicatedProcedures || []), assessment.plan?.otherProcedure].filter(Boolean)) },
    { label: "Frequência recomendada", value: assessment.plan?.recommendedFrequency || "-" }
  ], 2);
  field("Orientacoes ao cliente", assessment.plan?.clientGuidance || "-");

  section("Termo e assinaturas");
  field(
    "Declaracao",
    "Declaro que fui devidamente avaliado(a), orientado(a) sobre o procedimento de limpeza de pele, seus beneficios, possiveis efeitos, cuidados recomendados e contraindicacoes, autorizando a realizacao do atendimento."
  );
  ensureSpace(78);
  y -= 66;
  signature("Assinatura do cliente", "ClientSignature", clientSignature, margin);
  signature("Assinatura do profissional", "ProfessionalSignature", professionalSignature, margin + (pageWidth - margin * 2 + 14) / 2);

  finishPage();
  pdf.setObject(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = pdf.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return pdf.build(catalogId);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      runtime: "server-js",
      message: "A Vercel esta usando server.js. Confira Root Directory, arquivos antigos e vercel.json."
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/daily-verse") {
    sendJson(res, 200, await readDailyVerse());
    return;
  }

  if (url.pathname.startsWith("/api/auth/")) {
    await handleAuth(req, res, url);
    return;
  }

  const auth = await readAuth();
  if (!auth || !isAuthenticated(req)) {
    sendJson(res, 401, { error: auth ? "Faça login para acessar." : "Crie a senha de acesso primeiro." });
    return;
  }

  const data = await readDb();
  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[1];
  const id = parts[2];

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, data);
    return;
  }

  if (resource === "patients") {
    if (req.method === "POST") {
      const patient = normalizePatient(await readBody(req));
      if (!patient.name) return sendJson(res, 400, { error: "Informe o nome do paciente." });
      data.patients.unshift(patient);
      await writeDb(data);
      return sendJson(res, 201, patient);
    }

    const index = data.patients.findIndex((patient) => patient.id === id);
    if (index < 0) return sendJson(res, 404, { error: "Paciente não encontrado." });

    if (req.method === "PUT") {
      const patient = normalizePatient(await readBody(req), data.patients[index]);
      if (!patient.name) return sendJson(res, 400, { error: "Informe o nome do paciente." });
      data.patients[index] = patient;
      await writeDb(data);
      return sendJson(res, 200, patient);
    }

    if (req.method === "DELETE") {
      data.patients.splice(index, 1);
      data.sessions = data.sessions.filter((session) => session.patientId !== id);
      data.appointments = data.appointments.filter((appointment) => appointment.patientId !== id);
      data.treatmentAssessments = data.treatmentAssessments.filter((assessment) => assessment.patientId !== id);
      await writeDb(data);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === "sessions") {
    if (req.method === "POST") {
      const session = normalizeSession(await readBody(req));
      if (!session.patientId) return sendJson(res, 400, { error: "Selecione um paciente." });
      data.sessions.unshift(session);
      await writeDb(data);
      return sendJson(res, 201, session);
    }

    const index = data.sessions.findIndex((session) => session.id === id);
    if (index < 0) return sendJson(res, 404, { error: "Evolucao não encontrada." });

    if (req.method === "DELETE") {
      data.sessions.splice(index, 1);
      await writeDb(data);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === "appointments") {
    if (req.method === "POST") {
      const appointment = normalizeAppointment(await readBody(req));
      if (!appointment.patientId) return sendJson(res, 400, { error: "Selecione um paciente." });
      data.appointments.push(appointment);
      await writeDb(data);
      return sendJson(res, 201, appointment);
    }

    const index = data.appointments.findIndex((appointment) => appointment.id === id);
    if (index < 0) return sendJson(res, 404, { error: "Agendamento não encontrado." });

    if (req.method === "PUT") {
      const appointment = normalizeAppointment(await readBody(req), data.appointments[index]);
      data.appointments[index] = appointment;
      await writeDb(data);
      return sendJson(res, 200, appointment);
    }

    if (req.method === "DELETE") {
      data.appointments.splice(index, 1);
      await writeDb(data);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === "treatment-assessments") {
    if (req.method === "POST") {
      const assessment = normalizeTreatmentAssessment(await readBody(req));
      data.treatmentAssessments.unshift(assessment);
      await writeDb(data);
      return sendJson(res, 201, assessment);
    }

    const index = data.treatmentAssessments.findIndex((assessment) => assessment.id === id);
    if (index < 0) return sendJson(res, 404, { error: "Avaliação não encontrada." });

    if (req.method === "GET" && parts[3] === "pdf") {
      const assessment = data.treatmentAssessments[index];
      const patient = data.patients.find((item) => item.id === assessment.patientId) || {};
      const pdfBuffer = await buildTreatmentAssessmentPdf(assessment, patient);
      const prefix = isGeriatricTreatment(assessment.treatment) ? "ficha-geriatrica" : "ficha-limpeza-pele";
      const filename = `${prefix}-${pdfSafeName(patient.name)}-${assessment.date || today}.pdf`;
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.length
      });
      res.end(pdfBuffer);
      return;
    }

    if (req.method === "DELETE") {
      data.treatmentAssessments.splice(index, 1);
      await writeDb(data);
      return sendJson(res, 200, { ok: true });
    }
  }

  sendJson(res, 405, { error: "Operacao não suportada." });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Acesso negado.");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado.");
  }
}

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: "Não foi possível concluir a operação.",
      detail: publicDebugError(error),
      runtime: "server-js"
    });
  }
});

server.listen(port, host, async () => {
  await ensureDb();
  const shownHost = host === "0.0.0.0" ? "localhost" : host;
  console.log("");
  console.log("Sistema de gestão de fisioterapia iniciado.");
  console.log(`Neste computador: http://${shownHost}:${port}`);
  if (host === "0.0.0.0") {
    for (const address of localAddresses()) {
      console.log(`Na rede local:  http://${address}:${port}`);
    }
  }
  console.log("");
  console.log("Para encerrar, pressione Ctrl+C.");
});
