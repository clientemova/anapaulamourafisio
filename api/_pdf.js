const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const today = new Date().toISOString().slice(0, 10);

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
    throw new Error("Imagem PNG invalida.");
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
    throw new Error("Formato de logo PNG nao suportado.");
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
      else if (filter !== 0) throw new Error("Filtro PNG nao suportado.");
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
      ...offsets.slice(1).map((item) => `${String(item).padStart(10, "0")} 00000 n `),
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
  const logoPath = path.join(process.cwd(), "public", "logo-sistema-v2.png");
  const logoImage = addPngImage(pdf, parsePng(await fs.readFile(logoPath)));
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
    return { label, lines, height: Math.max(24, 16 + lines.length * 8.2) };
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
    prepared.forEach((item, index) => drawFieldBox(item, margin + index * (width + gap), y, width, rowHeight));
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

  text("Ficha de avaliacao - Limpeza de pele", margin, y, 14, true);
  y -= 14;
  text(`Gerada em ${formatDatePt(today)}`, margin, y, 8.5, false, "0.37 0.45 0.47");

  section("Identificacao pessoal");
  field("Nome", patient.name || "Sem paciente vinculado");
  fieldRow([
    { label: "Data da avaliacao", value: formatDatePt(assessment.date) },
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
  field("Procedimentos esteticos faciais", yesNoTextPdf(assessment.health?.previousFacialProcedure));

  section("Habitos e rotina de cuidados");
  fieldRow([
    { label: "Usa protetor solar diariamente?", value: assessment.habits?.sunscreen || "-" },
    { label: "Frequencia de limpeza facial", value: assessment.habits?.cleaningFrequency || "-" }
  ], 2);
  field("Produtos que utiliza em casa", assessment.habits?.homeProducts || "-");

  section("Avaliacao da pele");
  fieldRow([
    { label: "Tipo de pele", value: listTextPdf(assessment.skin?.skinTypes) },
    { label: "Fototipo", value: assessment.skin?.phototype || "-" }
  ], 2);
  fieldRow([
    { label: "Condicoes observadas", value: listTextPdf(assessment.skin?.observedConditions) },
    { label: "Outros", value: assessment.skin?.otherConditions || "-" }
  ], 2);

  section("Plano do tratamento");
  field("Diagnostico estetico", assessment.plan?.diagnosis || "-");
  field("Objetivo do tratamento", assessment.plan?.objective || "-");
  fieldRow([
    { label: "Procedimento indicado", value: listTextPdf([...(assessment.plan?.indicatedProcedures || []), assessment.plan?.otherProcedure].filter(Boolean)) },
    { label: "Frequencia recomendada", value: assessment.plan?.recommendedFrequency || "-" }
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

module.exports = {
  buildTreatmentAssessmentPdf,
  pdfSafeName
};
