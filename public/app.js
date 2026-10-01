const state = {
  patients: [],
  sessions: [],
  appointments: [],
  treatmentAssessments: [],
  selectedPatientId: null,
  view: "painel",
  authMode: "login"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const today = new Date().toISOString().slice(0, 10);

const patientDialog = $("#patientDialog");
const sessionDialog = $("#sessionDialog");
const appointmentDialog = $("#appointmentDialog");
const assessmentChoiceDialog = $("#assessmentChoiceDialog");
const skinAssessmentDialog = $("#skinAssessmentDialog");
const geriatricAssessmentDialog = $("#geriatricAssessmentDialog");
const passwordDialog = $("#passwordDialog");
const patientForm = $("#patientForm");
const sessionForm = $("#sessionForm");
const appointmentForm = $("#appointmentForm");
const assessmentChoiceForm = $("#assessmentChoiceForm");
const skinAssessmentForm = $("#skinAssessmentForm");
const geriatricAssessmentForm = $("#geriatricAssessmentForm");
const passwordForm = $("#passwordForm");
const authForm = $("#authForm");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Sem data";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function calculateAge(value) {
  if (!value) return "";
  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return `${age} anos`;
}

function byDateDesc(a, b) {
  return String(b.date || "").localeCompare(String(a.date || ""));
}

function patientName(id) {
  if (!id) return "Sem paciente vinculado";
  return state.patients.find((patient) => patient.id === id)?.name || "Paciente removido";
}

function patientById(id) {
  return state.patients.find((patient) => patient.id === id);
}

function assessmentById(id) {
  return state.treatmentAssessments.find((assessment) => assessment.id === id);
}

function treatmentSummary(assessment) {
  if (assessment.treatment === "Fisioterapia geriatrica") {
    return {
      frequency: assessment.plan?.recommendedFrequency || "Sem frequencia",
      primary: assessment.plan?.diagnosis || assessment.complaint || "Sem diagnostico registrado.",
      secondary: assessment.plan?.objective || assessment.plan?.treatmentPlan || "Sem objetivo registrado."
    };
  }

  return {
    frequency: assessment.plan?.recommendedFrequency || "Sem frequencia",
    primary: assessment.plan?.diagnosis || "Sem diagnostico estetico registrado.",
    secondary: assessment.plan?.objective || "Sem objetivo registrado."
  };
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    showAuth("login");
  }
  if (!response.ok) throw new Error(payload.error || "Nao foi possivel salvar.");
  return payload;
}

function isPublishedHost() {
  return !["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function setAuthAlert(message) {
  const alert = $("#authAlert");
  if (!message) {
    alert.hidden = true;
    alert.textContent = "";
    return;
  }
  alert.hidden = false;
  alert.textContent = message;
}

async function readHealthMessage() {
  try {
    const response = await fetch("/api/health", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (payload.ok) {
      return "O teste /api/health esta ok. Confira /api/auth/status e se este e o ultimo deploy da Vercel.";
    }
    const details = [
      payload.firebaseServiceAccountBase64 === "nao configurado" ? "FIREBASE_SERVICE_ACCOUNT_BASE64 nao configurado" : "",
      payload.initialAdminPassword === "nao configurado" ? "INITIAL_ADMIN_PASSWORD nao configurado" : "",
      payload.firestore?.write === "falhou" ? payload.firestore?.error?.message : ""
    ].filter(Boolean);
    return details.length ? details.join(". ") : payload.message || "A API nao conseguiu confirmar a configuracao do Firebase.";
  } catch (error) {
    return "Nao foi possivel abrir /api/health. Confirme se o deploy novo da Vercel terminou.";
  }
}

function showAuth(mode) {
  state.authMode = mode;
  document.body.classList.add("is-locked");
  $("#authScreen").hidden = false;
  $("#authPassword").value = "";
  setAuthAlert("");
  $("#authPassword").autocomplete = mode === "setup" ? "new-password" : "current-password";
  $("#authEyebrow").textContent = mode === "setup" ? "Primeiro acesso" : "Seguranca";
  $("#authTitle").textContent = mode === "setup" ? "Crie a senha de acesso" : "Entrar na plataforma";
  $("#authText").textContent =
    mode === "setup"
      ? "Esta senha vai proteger os dados dos pacientes."
      : "Digite a senha para acessar os dados da clinica.";
  $("#authSubmit").textContent = mode === "setup" ? "Criar senha e entrar" : "Entrar";
  window.setTimeout(() => $("#authPassword").focus(), 50);
}

function hideAuth() {
  $("#authScreen").hidden = true;
  document.body.classList.remove("is-locked");
}

async function checkAuth() {
  const status = await api("/api/auth/status");
  if (!status.configured) {
    showAuth("setup");
    if (isPublishedHost() && !status.initialPasswordConfigured) {
      setAuthAlert("A Vercel ainda nao recebeu INITIAL_ADMIN_PASSWORD ou este link esta em um deploy antigo. Configure a variavel em Production e faca Redeploy.");
    }
    return;
  }
  if (!status.authenticated) {
    showAuth("login");
    return;
  }
  hideAuth();
  await loadState();
}

async function loadState() {
  const payload = await api("/api/state");
  state.patients = payload.patients || [];
  state.sessions = payload.sessions || [];
  state.appointments = payload.appointments || [];
  state.treatmentAssessments = payload.treatmentAssessments || [];
  if (!state.selectedPatientId && state.patients[0]) state.selectedPatientId = state.patients[0].id;
  if (state.selectedPatientId && !patientById(state.selectedPatientId)) {
    state.selectedPatientId = state.patients[0]?.id || null;
  }
  render();
}

function render() {
  renderMetrics();
  renderToday();
  renderUpcomingAppointments();
  renderPriorityPatients();
  renderPatients();
  renderPatientDetail();
  renderSchedule();
  renderTreatments();
  fillAppointmentPatients();
  fillTreatmentPatients();
}

function renderMetrics() {
  const active = state.patients.filter((patient) => patient.status === "ativo").length;
  const todayCount = state.appointments.filter((appointment) => appointment.date === today).length;
  const averagePain = state.patients.length
    ? (state.patients.reduce((sum, patient) => sum + Number(patient.pain || 0), 0) / state.patients.length).toFixed(1)
    : "0";
  const recentSessions = state.sessions.filter((session) => session.date >= addDays(today, -7)).length;
  const assessments = state.treatmentAssessments.length;

  $("#metricGrid").innerHTML = [
    ["Pacientes ativos", active],
    ["Atendimentos hoje", todayCount],
    ["Dor media", averagePain],
    ["Evolucoes em 7 dias", recentSessions],
    ["Avaliacoes", assessments]
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function renderToday() {
  const appointments = state.appointments
    .filter((appointment) => appointment.date === today)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  $("#todayAppointments").innerHTML = appointments.length
    ? appointments.map(renderMiniAppointment).join("")
    : `<div class="empty-state">Nenhum atendimento marcado para hoje.</div>`;
}

function renderMiniAppointment(appointment) {
  return `
    <article class="mini-card">
      <div class="appointment-row">
        <div>
          <strong>${escapeHtml(appointment.time)} · ${escapeHtml(patientName(appointment.patientId))}</strong>
          <span class="meta">${escapeHtml(appointment.treatment || "Fisioterapia")} · ${escapeHtml(appointment.therapist || "Sem terapeuta")} · ${escapeHtml(appointment.room || "Sem sala")}</span>
        </div>
        ${statusPill(appointment.status)}
      </div>
    </article>
  `;
}

function appointmentDateTime(appointment) {
  return `${appointment.date || ""} ${appointment.time || "00:00"}`;
}

function renderUpcomingAppointments() {
  const upcoming = state.appointments
    .filter((appointment) => appointment.date > today || (appointment.date === today && appointment.time))
    .filter((appointment) => appointment.status !== "cancelado")
    .sort((a, b) => appointmentDateTime(a).localeCompare(appointmentDateTime(b)))
    .slice(0, 18);

  const root = $("#upcomingAppointments");
  if (!root) return;

  if (!upcoming.length) {
    root.innerHTML = `<div class="empty-state">Nenhum agendamento futuro cadastrado.</div>`;
    return;
  }

  const grouped = upcoming.reduce((groups, appointment) => {
    const key = appointment.date || "Sem data";
    if (!groups[key]) groups[key] = [];
    groups[key].push(appointment);
    return groups;
  }, {});

  root.innerHTML = Object.entries(grouped)
    .map(([date, appointments]) => {
      const countLabel = appointments.length === 1 ? "1 horario" : `${appointments.length} horarios`;
      return `
        <section class="upcoming-day">
          <div class="upcoming-date">
            <strong>${escapeHtml(date === "Sem data" ? date : formatDate(date))}</strong>
            <span>${countLabel}</span>
          </div>
          <div class="stack">
            ${appointments.map(renderUpcomingAppointment).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderUpcomingAppointment(appointment) {
  return `
    <article class="mini-card upcoming-card">
      <div>
        <strong>${escapeHtml(appointment.time || "--:--")} · ${escapeHtml(patientName(appointment.patientId))}</strong>
        <span class="meta">${escapeHtml(appointment.treatment || "Fisioterapia")} · ${escapeHtml(appointment.therapist || "Sem terapeuta")} · ${escapeHtml(appointment.room || "Sem sala")}</span>
      </div>
      ${statusPill(appointment.status)}
    </article>
  `;
}

function renderPriorityPatients() {
  const patients = [...state.patients]
    .filter((patient) => patient.status === "ativo")
    .sort((a, b) => Number(b.pain || 0) - Number(a.pain || 0))
    .slice(0, 4);

  $("#priorityPatients").innerHTML = patients.length
    ? patients
        .map(
          (patient) => `
            <button class="mini-card patient-card" type="button" data-select-patient="${patient.id}">
              <div class="status-row">
                <strong>${escapeHtml(patient.name)}</strong>
                <span>Dor ${Number(patient.pain || 0)}/10</span>
              </div>
              <p class="meta">${escapeHtml(patient.condition || "Sem diagnostico informado")}</p>
              <div class="progress-shell" aria-label="Dor atual">
                <div class="progress-bar" style="width:${Math.min(100, Number(patient.pain || 0) * 10)}%"></div>
              </div>
            </button>
          `
        )
        .join("")
    : `<div class="empty-state">Nenhum paciente ativo cadastrado.</div>`;
}

function renderPatients() {
  const term = $("#searchInput").value.trim().toLowerCase();
  const status = $("#statusFilter").value;
  const patients = state.patients.filter((patient) => {
    const haystack = [patient.name, patient.condition, patient.therapist, patient.phone].join(" ").toLowerCase();
    const matchesTerm = !term || haystack.includes(term);
    const matchesStatus = status === "todos" || patient.status === status;
    return matchesTerm && matchesStatus;
  });

  $("#patientList").innerHTML = patients.length
    ? patients.map(renderPatientCard).join("")
    : `<div class="empty-state">Nenhum paciente encontrado com estes filtros.</div>`;
}

function renderPatientCard(patient) {
  const selected = patient.id === state.selectedPatientId ? " is-selected" : "";
  return `
    <button class="patient-card${selected}" type="button" data-select-patient="${patient.id}">
      <div class="status-row">
        <div>
          <strong>${escapeHtml(patient.name)}</strong>
          <span class="meta">${escapeHtml(patient.condition || "Sem diagnostico")}</span>
        </div>
        ${statusPill(patient.status)}
      </div>
      <div class="status-row meta">
        <span>${escapeHtml(patient.therapist || "Sem terapeuta")}</span>
        <span>Dor ${Number(patient.pain || 0)}/10</span>
      </div>
    </button>
  `;
}

function renderPatientDetail() {
  const patient = patientById(state.selectedPatientId);
  const root = $("#patientDetail");

  if (!patient) {
    root.innerHTML = `<div class="empty-state">Selecione ou cadastre um paciente para ver os detalhes.</div>`;
    return;
  }

  const sessions = state.sessions.filter((session) => session.patientId === patient.id).sort(byDateDesc);
  const appointments = state.appointments
    .filter((appointment) => appointment.patientId === patient.id)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .slice(0, 4);
  const treatmentAssessments = state.treatmentAssessments
    .filter((assessment) => assessment.patientId === patient.id)
    .sort(byDateDesc);

  root.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(patient.name)}</h2>
        <p class="muted">${escapeHtml(patient.condition || "Sem diagnostico informado")}</p>
      </div>
      <div class="item-actions">
        <button class="button ghost" type="button" data-edit-patient="${patient.id}">Editar</button>
        <button class="button ghost" type="button" data-new-assessment="${patient.id}">Nova avaliacao</button>
        <button class="button primary" type="button" data-new-session="${patient.id}">Nova evolucao</button>
      </div>
    </div>

    <div class="detail-grid">
      ${detailField("Status", statusPill(patient.status), true)}
      ${detailField("Idade", escapeHtml(calculateAge(patient.birthDate) || "Nao informada"))}
      ${detailField("Telefone", escapeHtml(patient.phone || "Nao informado"))}
      ${detailField("Terapeuta", escapeHtml(patient.therapist || "Nao informado"))}
      ${detailField("Frequencia", escapeHtml(patient.frequency || "Nao informada"))}
      ${detailField("Inicio", escapeHtml(formatDate(patient.startedAt)))}
    </div>

    <section>
      <h3>Plano terapeutico</h3>
      <p class="muted">${escapeHtml(patient.goals || "Nenhum objetivo registrado.")}</p>
      <div class="progress-shell" aria-label="Dor atual">
        <div class="progress-bar" style="width:${Math.min(100, Number(patient.pain || 0) * 10)}%"></div>
      </div>
      <p class="meta">Dor atual: ${Number(patient.pain || 0)}/10</p>
    </section>

    <section>
      <div class="panel-head">
        <h3>Tratamentos esteticos</h3>
        <button class="button ghost" type="button" data-new-assessment="${patient.id}">Nova avaliacao</button>
      </div>
      <div class="timeline">
        ${
          treatmentAssessments.length
            ? treatmentAssessments.map(renderTreatmentAssessment).join("")
            : `<div class="empty-state">Nenhuma avaliacao registrada.</div>`
        }
      </div>
    </section>

    <section>
      <div class="panel-head">
        <h3>Evolucoes</h3>
      </div>
      <div class="timeline">
        ${
          sessions.length
            ? sessions.map(renderSession).join("")
            : `<div class="empty-state">Ainda nao ha evolucoes registradas.</div>`
        }
      </div>
    </section>

    <section>
      <div class="panel-head">
        <h3>Proximos horarios</h3>
        <button class="button ghost" type="button" data-new-appointment="${patient.id}">Agendar</button>
      </div>
      <div class="stack">
        ${
          appointments.length
            ? appointments.map(renderMiniAppointment).join("")
            : `<div class="empty-state">Nenhum horario registrado para este paciente.</div>`
        }
      </div>
    </section>

    <div class="dialog-actions">
      <button class="button danger" type="button" data-delete-patient="${patient.id}">Excluir paciente</button>
    </div>
  `;
}

function detailField(label, value, raw = false) {
  return `
    <div class="detail-field">
      <span>${label}</span>
      <strong>${raw ? value : value}</strong>
    </div>
  `;
}

function renderSession(session) {
  return `
    <article class="timeline-item">
      <div class="status-row">
        <strong>${escapeHtml(formatDate(session.date))} · ${escapeHtml(session.type)}</strong>
        <span class="meta">Dor ${Number(session.pain || 0)}/10</span>
      </div>
      <p>${escapeHtml(session.summary)}</p>
      <p class="meta">${escapeHtml(session.plan || "Sem conduta registrada.")}</p>
      <button class="button ghost" type="button" data-delete-session="${session.id}">Remover</button>
    </article>
  `;
}

function renderTreatmentAssessment(assessment) {
  return assessment.treatment === "Fisioterapia geriatrica"
    ? renderGeriatricAssessment(assessment)
    : renderSkinAssessment(assessment);
}

function renderSkinAssessment(assessment) {
  const procedures = [
    ...(assessment.plan?.indicatedProcedures || []),
    assessment.plan?.otherProcedure
  ].filter(Boolean);
  const conditions = [
    ...(assessment.skin?.observedConditions || []),
    assessment.skin?.otherConditions
  ].filter(Boolean);

  return `
    <article class="timeline-item">
      <div class="status-row">
        <strong>${escapeHtml(formatDate(assessment.date))} · ${escapeHtml(assessment.treatment)}</strong>
        <span class="meta">${escapeHtml(assessment.plan?.recommendedFrequency || "Sem frequencia")}</span>
      </div>
      <p>${escapeHtml(assessment.plan?.diagnosis || "Sem diagnostico estetico registrado.")}</p>
      <p class="meta">Procedimento: ${escapeHtml(procedures.join(", ") || "Nao informado")}</p>
      <p class="meta">Condicoes: ${escapeHtml(conditions.join(", ") || "Nao informadas")}</p>
      <div class="item-actions">
        <button class="button ghost" type="button" data-pdf-skin-assessment="${assessment.id}">Gerar PDF</button>
        <button class="button ghost" type="button" data-delete-skin-assessment="${assessment.id}">Remover</button>
      </div>
    </article>
  `;
}

function renderGeriatricAssessment(assessment) {
  const antecedents = [
    ...(assessment.history?.antecedents || []),
    assessment.history?.otherAntecedents
  ].filter(Boolean);

  return `
    <article class="timeline-item">
      <div class="status-row">
        <strong>${escapeHtml(formatDate(assessment.date))} · ${escapeHtml(assessment.treatment)}</strong>
        <span class="meta">${escapeHtml(assessment.plan?.recommendedFrequency || "Sem frequencia")}</span>
      </div>
      <p>${escapeHtml(assessment.plan?.diagnosis || assessment.complaint || "Sem diagnostico registrado.")}</p>
      <p class="meta">Deambulacao: ${escapeHtml(assessment.functional?.ambulation || "Nao informada")}</p>
      <p class="meta">Antecedentes: ${escapeHtml(antecedents.join(", ") || "Nao informados")}</p>
      <div class="item-actions">
        <button class="button ghost" type="button" data-delete-skin-assessment="${assessment.id}">Remover</button>
      </div>
    </article>
  `;
}

function renderTreatments() {
  const treatmentFilter = $("#treatmentFilter")?.value || "todos";
  const patientFilter = $("#treatmentPatientFilter")?.value || "todos";
  const assessments = state.treatmentAssessments
    .filter((assessment) => treatmentFilter === "todos" || assessment.treatment === treatmentFilter)
    .filter((assessment) => patientFilter === "todos" || assessment.patientId === patientFilter)
    .sort(byDateDesc);

  $("#treatmentList").innerHTML = assessments.length
    ? assessments
        .map(
          renderTreatmentCard
        )
        .join("")
    : `<div class="empty-state">Nenhuma avaliacao encontrada.</div>`;
}

function renderTreatmentCard(assessment) {
  const summary = treatmentSummary(assessment);
  const pdfButton = assessment.treatment === "Limpeza de pele"
    ? `<button class="button ghost" type="button" data-pdf-skin-assessment="${assessment.id}">Gerar PDF</button>`
    : "";

  return `
    <article class="schedule-card">
      <div class="time-block">${escapeHtml(formatDate(assessment.date))}</div>
      <div>
        <strong>${escapeHtml(patientName(assessment.patientId))}</strong>
        <p class="meta">${escapeHtml(assessment.treatment)} · ${escapeHtml(summary.frequency)}</p>
        <p class="muted">${escapeHtml(summary.secondary || summary.primary)}</p>
      </div>
      <div class="stack">
        <button class="button ghost" type="button" data-select-patient="${assessment.patientId}">Ver paciente</button>
        ${pdfButton}
        <button class="button ghost" type="button" data-delete-skin-assessment="${assessment.id}">Remover</button>
      </div>
    </article>
  `;
}

function renderSchedule() {
  const selectedDate = $("#agendaDate").value || today;
  const status = $("#agendaStatus").value;
  const appointments = state.appointments
    .filter((appointment) => appointment.date === selectedDate)
    .filter((appointment) => status === "todos" || appointment.status === status)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  $("#scheduleList").innerHTML = appointments.length
    ? appointments.map(renderScheduleCard).join("")
    : `<div class="empty-state">Nenhum horario encontrado para esta data.</div>`;
}

function renderScheduleCard(appointment) {
  return `
    <article class="schedule-card">
      <div class="time-block">${escapeHtml(appointment.time)}</div>
      <div>
        <strong>${escapeHtml(patientName(appointment.patientId))}</strong>
        <p class="meta">${escapeHtml(appointment.treatment || "Fisioterapia")} · ${escapeHtml(appointment.therapist || "Sem terapeuta")} · ${escapeHtml(appointment.duration)} min · ${escapeHtml(appointment.room || "Sem sala")}</p>
        <p class="muted">${escapeHtml(appointment.notes || "Sem observacoes.")}</p>
      </div>
      <div class="stack">
        ${statusPill(appointment.status)}
        <select data-update-appointment="${appointment.id}" aria-label="Alterar status de ${escapeHtml(patientName(appointment.patientId))}">
          ${["agendado", "confirmado", "realizado", "cancelado"]
            .map((status) => `<option value="${status}" ${appointment.status === status ? "selected" : ""}>${capitalize(status)}</option>`)
            .join("")}
        </select>
        <button class="button ghost" type="button" data-delete-appointment="${appointment.id}">Remover</button>
      </div>
    </article>
  `;
}

function statusPill(status) {
  const normalized = status || "ativo";
  return `<span class="status-pill status-${escapeHtml(normalized)}">${escapeHtml(capitalize(normalized))}</span>`;
}

function capitalize(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fillAppointmentPatients() {
  const select = appointmentForm.elements.patientId;
  const current = select.value;
  select.innerHTML = state.patients
    .map((patient) => `<option value="${patient.id}">${escapeHtml(patient.name)}</option>`)
    .join("");
  if (current) select.value = current;
}

function fillTreatmentPatients() {
  const select = $("#treatmentPatientFilter");
  if (!select) return;
  const current = select.value || "todos";
  select.innerHTML = [
    `<option value="todos">Todos os pacientes</option>`,
    ...state.patients.map((patient) => `<option value="${patient.id}">${escapeHtml(patient.name)}</option>`)
  ].join("");
  select.value = state.patients.some((patient) => patient.id === current) ? current : "todos";

  const assessmentPatient = $("#skinAssessmentPatient");
  if (assessmentPatient) {
    const selected = assessmentPatient.value;
    assessmentPatient.innerHTML = state.patients
      .map((patient) => `<option value="${patient.id}">${escapeHtml(patient.name)}</option>`)
      .join("");
    if (selected) assessmentPatient.value = selected;
  }

  const geriatricPatient = $("#geriatricAssessmentPatient");
  if (geriatricPatient) {
    const selected = geriatricPatient.value;
    geriatricPatient.innerHTML = state.patients
      .map((patient) => `<option value="${patient.id}">${escapeHtml(patient.name)}</option>`)
      .join("");
    if (selected) geriatricPatient.value = selected;
  }
}

function switchView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("is-visible", element.id === `view-${view}`));
  $$("[data-view-link]").forEach((link) => link.classList.toggle("is-active", link.dataset.viewLink === view));
}

function openPatientDialog(patient = null) {
  patientForm.reset();
  $("#patientDialogTitle").textContent = patient ? "Editar paciente" : "Novo paciente";
  const values = patient || { status: "ativo", pain: 0, startedAt: today };
  for (const [key, value] of Object.entries(values)) {
    if (patientForm.elements[key]) patientForm.elements[key].value = value ?? "";
  }
  patientDialog.showModal();
}

function openSessionDialog(patientId) {
  sessionForm.reset();
  sessionForm.elements.patientId.value = patientId;
  sessionForm.elements.date.value = today;
  sessionDialog.showModal();
}

function openAppointmentDialog(patientId = "") {
  appointmentForm.reset();
  fillAppointmentPatients();
  appointmentForm.elements.date.value = $("#agendaDate").value || today;
  appointmentForm.elements.time.value = "08:00";
  appointmentForm.elements.duration.value = "50";
  if (patientId) appointmentForm.elements.patientId.value = patientId;
  appointmentDialog.showModal();
}

function openAssessmentChoiceDialog(patientId = "") {
  assessmentChoiceForm.dataset.patientId = patientId || state.selectedPatientId || state.patients[0]?.id || "";
  assessmentChoiceDialog.showModal();
}

function formToObject(form) {
  const data = {};
  const formData = new FormData(form);
  for (const [key, value] of formData.entries()) {
    if (Object.hasOwn(data, key)) {
      data[key] = Array.isArray(data[key]) ? [...data[key], value] : [data[key], value];
    } else {
      data[key] = value;
    }
  }
  return data;
}

function setupSignaturePads() {
  $$("[data-signature-pad]").forEach((canvas) => {
    const context = canvas.getContext("2d");
    context.lineWidth = 3;
    context.lineCap = "round";
    context.strokeStyle = "#142327";
    canvas.dataset.empty = "true";
    let drawing = false;

    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
      };
    };

    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const current = point(event);
      context.beginPath();
      context.moveTo(current.x, current.y);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const current = point(event);
      context.lineTo(current.x, current.y);
      context.stroke();
      canvas.dataset.empty = "false";
    });

    const stop = () => {
      drawing = false;
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);
  });
}

function clearSignature(name) {
  const canvas = $(`[data-signature-pad="${name}"]`);
  if (!canvas) return;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  canvas.dataset.empty = "true";
  const form = canvas.closest("form");
  if (form?.elements[name]) form.elements[name].value = "";
}

function resetSignatures(form) {
  $$("[data-signature-pad]", form).forEach((canvas) => clearSignature(canvas.dataset.signaturePad));
}

function captureSignatures(form) {
  $$("[data-signature-pad]", form).forEach((canvas) => {
    const inputName = canvas.dataset.signaturePad;
    const input = form.elements[inputName];
    if (input) input.value = canvas.dataset.empty === "false" ? canvas.toDataURL("image/png") : "";
  });
}

async function downloadSkinAssessmentPdf(id) {
  const response = await fetch(`/api/treatment-assessments/${id}/pdf`, { credentials: "same-origin" });
  if (response.status === 401) showAuth("login");
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Nao foi possivel gerar o PDF.");
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "ficha-limpeza-pele.pdf";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function openSkinAssessmentDialog(patientId = "") {
  skinAssessmentForm.reset();
  resetSignatures(skinAssessmentForm);
  fillTreatmentPatients();
  const selectedPatientId = patientId || state.selectedPatientId || state.patients[0]?.id || "";
  const patientSelect = $("#skinAssessmentPatient");
  if (patientSelect) patientSelect.value = selectedPatientId;
  if (skinAssessmentForm.elements.patientId) skinAssessmentForm.elements.patientId.value = selectedPatientId;
  if (skinAssessmentForm.elements.date) skinAssessmentForm.elements.date.value = today;
  skinAssessmentDialog.showModal();
}

function openGeriatricAssessmentDialog(patientId = "") {
  geriatricAssessmentForm.reset();
  resetSignatures(geriatricAssessmentForm);
  fillTreatmentPatients();
  const selectedPatientId = patientId || state.selectedPatientId || state.patients[0]?.id || "";
  const patientSelect = $("#geriatricAssessmentPatient");
  if (patientSelect) patientSelect.value = selectedPatientId;
  if (geriatricAssessmentForm.elements.patientId) geriatricAssessmentForm.elements.patientId.value = selectedPatientId;
  if (geriatricAssessmentForm.elements.date) geriatricAssessmentForm.elements.date.value = today;
  geriatricAssessmentDialog.showModal();
}

patientForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    const body = formToObject(patientForm);
    const id = body.id;
    const saved = await api(id ? `/api/patients/${id}` : "/api/patients", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
    state.selectedPatientId = saved.id;
    patientDialog.close();
    await loadState();
    switchView("pacientes");
    showToast("Paciente salvo.");
  } catch (error) {
    showToast(error.message);
  }
});

sessionForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    await api("/api/sessions", { method: "POST", body: JSON.stringify(formToObject(sessionForm)) });
    sessionDialog.close();
    await loadState();
    showToast("Evolucao registrada.");
  } catch (error) {
    showToast(error.message);
  }
});

appointmentForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    await api("/api/appointments", { method: "POST", body: JSON.stringify(formToObject(appointmentForm)) });
    appointmentDialog.close();
    await loadState();
    showToast("Agendamento salvo.");
  } catch (error) {
    showToast(error.message);
  }
});

skinAssessmentForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    captureSignatures(skinAssessmentForm);
    await api("/api/treatment-assessments", {
      method: "POST",
      body: JSON.stringify(formToObject(skinAssessmentForm))
    });
    skinAssessmentDialog.close();
    await loadState();
    switchView("tratamentos");
    showToast("Avaliacao de limpeza de pele salva.");
  } catch (error) {
    showToast(error.message);
  }
});

geriatricAssessmentForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    captureSignatures(geriatricAssessmentForm);
    await api("/api/treatment-assessments", {
      method: "POST",
      body: JSON.stringify(formToObject(geriatricAssessmentForm))
    });
    geriatricAssessmentDialog.close();
    await loadState();
    switchView("tratamentos");
    showToast("Avaliacao geriatrica salva.");
  } catch (error) {
    showToast(error.message);
  }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const password = $("#authPassword").value;
    const path = state.authMode === "setup" ? "/api/auth/setup" : "/api/auth/login";
    await api(path, { method: "POST", body: JSON.stringify({ password }) });
    hideAuth();
    await loadState();
    showToast(state.authMode === "setup" ? "Senha criada." : "Acesso liberado.");
  } catch (error) {
    let message = error.message;
    if (state.authMode === "setup" && isPublishedHost()) {
      message = `${message} Diagnostico: ${await readHealthMessage()}`;
    }
    setAuthAlert(message);
    showToast(error.message);
  }
});

passwordForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(formToObject(passwordForm))
    });
    passwordDialog.close();
    passwordForm.reset();
    showAuth("login");
    showToast("Senha alterada. Entre novamente.");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const selectPatient = event.target.closest("[data-select-patient]");
  if (selectPatient) {
    state.selectedPatientId = selectPatient.dataset.selectPatient;
    switchView("pacientes");
    render();
    return;
  }

  const editPatient = event.target.closest("[data-edit-patient]");
  if (editPatient) {
    openPatientDialog(patientById(editPatient.dataset.editPatient));
    return;
  }

  const newSession = event.target.closest("[data-new-session]");
  if (newSession) {
    openSessionDialog(newSession.dataset.newSession);
    return;
  }

  const newAppointment = event.target.closest("[data-new-appointment]");
  if (newAppointment) {
    openAppointmentDialog(newAppointment.dataset.newAppointment);
    return;
  }

  const newAssessment = event.target.closest("[data-new-assessment]");
  if (newAssessment) {
    openAssessmentChoiceDialog(newAssessment.dataset.newAssessment);
    return;
  }

  const newSkinAssessment = event.target.closest("[data-new-skin-assessment]");
  if (newSkinAssessment) {
    openAssessmentChoiceDialog(newSkinAssessment.dataset.newSkinAssessment);
    return;
  }

  const startAssessment = event.target.closest("[data-start-assessment]");
  if (startAssessment) {
    const patientId = assessmentChoiceForm.dataset.patientId || state.selectedPatientId || "";
    assessmentChoiceDialog.close();
    if (startAssessment.dataset.startAssessment === "geriatric") {
      openGeriatricAssessmentDialog(patientId);
    } else {
      openSkinAssessmentDialog(patientId);
    }
    return;
  }

  const clearSignatureButton = event.target.closest("[data-clear-signature]");
  if (clearSignatureButton) {
    clearSignature(clearSignatureButton.dataset.clearSignature);
    return;
  }

  const pdfSkinAssessmentButton = event.target.closest("[data-pdf-skin-assessment]");
  if (pdfSkinAssessmentButton) {
    try {
      await downloadSkinAssessmentPdf(pdfSkinAssessmentButton.dataset.pdfSkinAssessment);
      showToast("PDF gerado.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const deletePatient = event.target.closest("[data-delete-patient]");
  if (deletePatient && confirm("Excluir este paciente e todos os registros vinculados?")) {
    await api(`/api/patients/${deletePatient.dataset.deletePatient}`, { method: "DELETE" });
    await loadState();
    showToast("Paciente excluido.");
    return;
  }

  const deleteSession = event.target.closest("[data-delete-session]");
  if (deleteSession && confirm("Remover esta evolucao?")) {
    await api(`/api/sessions/${deleteSession.dataset.deleteSession}`, { method: "DELETE" });
    await loadState();
    showToast("Evolucao removida.");
    return;
  }

  const deleteAppointment = event.target.closest("[data-delete-appointment]");
  if (deleteAppointment && confirm("Remover este agendamento?")) {
    await api(`/api/appointments/${deleteAppointment.dataset.deleteAppointment}`, { method: "DELETE" });
    await loadState();
    showToast("Agendamento removido.");
    return;
  }

  const deleteSkinAssessment = event.target.closest("[data-delete-skin-assessment]");
  if (deleteSkinAssessment && confirm("Remover esta avaliacao?")) {
    await api(`/api/treatment-assessments/${deleteSkinAssessment.dataset.deleteSkinAssessment}`, { method: "DELETE" });
    await loadState();
    showToast("Avaliacao removida.");
  }
});

document.addEventListener("change", async (event) => {
  const appointmentStatus = event.target.closest("[data-update-appointment]");
  if (!appointmentStatus) return;
  const appointment = state.appointments.find((item) => item.id === appointmentStatus.dataset.updateAppointment);
  if (!appointment) return;
  await api(`/api/appointments/${appointment.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...appointment, status: appointmentStatus.value })
  });
  await loadState();
  showToast("Status atualizado.");
});

$$("[data-view-link]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(link.dataset.viewLink);
  });
});

$$("[data-view-link-button]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewLinkButton));
});

$("#newPatientButton").addEventListener("click", () => openPatientDialog());
$("#refreshButton").addEventListener("click", () => loadState().then(() => showToast("Dados atualizados.")));
$("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showAuth("login");
  showToast("Voce saiu da plataforma.");
});
$("#changePasswordButton").addEventListener("click", () => {
  passwordForm.reset();
  passwordDialog.showModal();
});
$("#quickAppointmentButton").addEventListener("click", () => openAppointmentDialog(state.selectedPatientId));
$("#newAppointmentButton").addEventListener("click", () => openAppointmentDialog(state.selectedPatientId));
$("#newAssessmentButton").addEventListener("click", () => openAssessmentChoiceDialog(state.selectedPatientId));
$("#searchInput").addEventListener("input", renderPatients);
$("#statusFilter").addEventListener("change", renderPatients);
$("#agendaDate").addEventListener("change", renderSchedule);
$("#agendaStatus").addEventListener("change", renderSchedule);
$("#treatmentFilter").addEventListener("change", renderTreatments);
$("#treatmentPatientFilter").addEventListener("change", renderTreatments);
$("#skinAssessmentPatient").addEventListener("change", (event) => {
  if (skinAssessmentForm.elements.patientId) skinAssessmentForm.elements.patientId.value = event.target.value;
});
$("#geriatricAssessmentPatient").addEventListener("change", (event) => {
  if (geriatricAssessmentForm.elements.patientId) geriatricAssessmentForm.elements.patientId.value = event.target.value;
});

$("#agendaDate").value = today;
setupSignaturePads();
checkAuth().catch((error) => {
  showAuth("login");
  showToast(error.message);
});
