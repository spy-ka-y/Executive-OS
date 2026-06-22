// Local PDF + PPTX report generation.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import PptxGenJS from "pptxgenjs";
import type { CeoBrief, ConsultantReport, KpiSummary, ActionPlan } from "./types";

const RUBINE = "6D3A3C";
const CAMEL = "C6B39A";
const TAMARIND = "361319";
const ITALIAN = "280B0F";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export interface ReportContent {
  title: string;
  datasetName: string;
  kpis: KpiSummary | null;
  brief: CeoBrief | null;
  consultant: ConsultantReport | null;
  plans: ActionPlan[];
}

export function exportPdf(content: ReportContent): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  // Cover
  doc.setFillColor(`#${ITALIAN}`);
  doc.rect(0, 0, W, doc.internal.pageSize.getHeight(), "F");
  doc.setTextColor(`#${CAMEL}`);
  doc.setFontSize(10);
  doc.text("RABBITT BI COPILOT — EXECUTIVE REPORT", 40, 60);
  doc.setFontSize(28);
  doc.setTextColor("#F0E6D2");
  doc.text(content.title, 40, 120, { maxWidth: W - 80 });
  doc.setFontSize(12);
  doc.setTextColor(`#${CAMEL}`);
  doc.text(`Dataset: ${content.datasetName}`, 40, 160);
  doc.text(new Date().toLocaleDateString(), 40, 178);

  // KPI page
  doc.addPage();
  doc.setTextColor("#1a1a1a");
  doc.setFontSize(20);
  doc.text("Key Performance Indicators", 40, 60);
  if (content.kpis) {
    autoTable(doc, {
      startY: 80,
      head: [["Metric", "Value"]],
      body: content.kpis.metrics.map((m) => [
        m.label,
        m.format === "currency" ? fmtMoney(m.value) : m.format === "percent" ? `${m.value.toFixed(1)}%` : m.value.toLocaleString(),
      ]),
      headStyles: { fillColor: `#${RUBINE}` },
    });
  }

  // CEO Brief
  if (content.brief) {
    doc.addPage();
    doc.setFontSize(20);
    doc.text("CEO Brief", 40, 60);
    doc.setFontSize(11);
    doc.text(`Health Score: ${content.brief.health_score}/100`, 40, 82);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(content.brief.summary, W - 80), 40, 110);
    autoTable(doc, {
      startY: 200,
      head: [["Risks", "Severity"]],
      body: content.brief.risks.map((r) => [`${r.title} — ${r.description}`, r.severity.toUpperCase()]),
      headStyles: { fillColor: `#${RUBINE}` },
    });
    autoTable(doc, {
      head: [["Opportunities", "Upside"]],
      body: content.brief.opportunities.map((o) => [`${o.title} — ${o.description}`, o.upside]),
      headStyles: { fillColor: `#${RUBINE}` },
    });
  }

  // Consultant
  if (content.consultant) {
    doc.addPage();
    doc.setFontSize(20);
    doc.text("Consultant Report", 40, 60);
    autoTable(doc, {
      startY: 80,
      head: [["Score", "Value"]],
      body: [
        ["Growth Potential", `${content.consultant.impact_score}/100`],
        ["Execution Difficulty", `${content.consultant.roi_score}/100`],
        ["Strategic Risk", `${content.consultant.risk_score}/100`],
      ],
      headStyles: { fillColor: `#${RUBINE}` },
    });
    autoTable(doc, {
      head: [["Recommendation", "Impact", "Effort", "Timeframe"]],
      body: content.consultant.recommendations.map((r) => [
        `${r.title} — ${r.description}`,
        r.impact,
        r.effort,
        r.timeframe,
      ]),
      headStyles: { fillColor: `#${RUBINE}` },
    });
  }

  // Action Plans
  if (content.plans.length > 0) {
    doc.addPage();
    doc.setFontSize(20);
    doc.text("Action Plans", 40, 60);
    for (const plan of content.plans) {
      autoTable(doc, {
        head: [[`${plan.horizon_days}-Day Roadmap`, "Owner", "Status", "Progress"]],
        body: plan.initiatives.map((i) => [
          `${i.title} — ${i.description}`,
          i.owner,
          i.status,
          `${i.progress}%`,
        ]),
        headStyles: { fillColor: `#${RUBINE}` },
      });
    }
  }

  return doc.output("blob");
}

export async function exportPptx(content: ReportContent): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  // Cover
  const cover = pptx.addSlide();
  cover.background = { color: ITALIAN };
  cover.addText("RABBITT BI COPILOT", { x: 0.5, y: 0.5, fontSize: 12, color: CAMEL, fontFace: "Inter" });
  cover.addText(content.title, { x: 0.5, y: 1.2, w: 12, fontSize: 44, color: "F0E6D2", bold: true, fontFace: "Georgia" });
  cover.addText(`Dataset: ${content.datasetName}\n${new Date().toLocaleDateString()}`, {
    x: 0.5, y: 3.2, fontSize: 16, color: CAMEL, fontFace: "Inter",
  });

  const cell = (text: string) => ({ text });
  const row = (cells: string[]) => cells.map(cell);

  // KPIs
  if (content.kpis) {
    const s = pptx.addSlide();
    s.background = { color: TAMARIND };
    s.addText("Key Performance Indicators", { x: 0.5, y: 0.3, fontSize: 28, color: "F0E6D2", bold: true, fontFace: "Georgia" });
    s.addTable(
      [row(["Metric", "Value"]), ...content.kpis.metrics.map((m) => row([
        m.label,
        m.format === "currency" ? fmtMoney(m.value) : m.format === "percent" ? `${m.value.toFixed(1)}%` : m.value.toLocaleString(),
      ]))],
      { x: 0.5, y: 1.2, w: 12, fontSize: 14, color: "F0E6D2", border: { type: "solid", color: RUBINE, pt: 1 } },
    );
  }

  // CEO Brief
  if (content.brief) {
    const s = pptx.addSlide();
    s.background = { color: TAMARIND };
    s.addText("CEO Brief", { x: 0.5, y: 0.3, fontSize: 28, color: "F0E6D2", bold: true, fontFace: "Georgia" });
    s.addText(`Health Score: ${content.brief.health_score}/100`, { x: 0.5, y: 1.1, fontSize: 16, color: CAMEL });
    s.addText(content.brief.summary, { x: 0.5, y: 1.6, w: 12, h: 2, fontSize: 14, color: "F0E6D2" });
    s.addText("Top Risks", { x: 0.5, y: 3.8, fontSize: 16, color: CAMEL, bold: true });
    s.addText(content.brief.risks.map((r) => `• ${r.title}: ${r.description}`).join("\n"), { x: 0.5, y: 4.2, w: 5.8, fontSize: 12, color: "F0E6D2" });
    s.addText("Opportunities", { x: 6.5, y: 3.8, fontSize: 16, color: CAMEL, bold: true });
    s.addText(content.brief.opportunities.map((o) => `• ${o.title} (${o.upside})`).join("\n"), { x: 6.5, y: 4.2, w: 5.8, fontSize: 12, color: "F0E6D2" });
  }

  // Consultant
  if (content.consultant) {
    const s = pptx.addSlide();
    s.background = { color: TAMARIND };
    s.addText("Consultant Report", { x: 0.5, y: 0.3, fontSize: 28, color: "F0E6D2", bold: true, fontFace: "Georgia" });
    s.addText(
      `Growth Potential ${content.consultant.impact_score} • Execution Difficulty ${content.consultant.roi_score} • Strategic Risk ${content.consultant.risk_score}`,
      { x: 0.5, y: 1.1, fontSize: 16, color: CAMEL },
    );
    s.addTable(
      [row(["Recommendation", "Impact", "Effort", "Timeframe"]), ...content.consultant.recommendations.map((r) => row([r.title, String(r.impact), String(r.effort), r.timeframe]))],
      { x: 0.5, y: 1.6, w: 12, fontSize: 12, color: "F0E6D2", border: { type: "solid", color: RUBINE, pt: 1 } },
    );
  }

  // Action Plans
  for (const plan of content.plans) {
    const s = pptx.addSlide();
    s.background = { color: TAMARIND };
    s.addText(`${plan.horizon_days}-Day Action Plan`, { x: 0.5, y: 0.3, fontSize: 28, color: "F0E6D2", bold: true, fontFace: "Georgia" });
    s.addTable(
      [row(["Initiative", "Owner", "Status", "Progress"]), ...plan.initiatives.map((i) => row([i.title, i.owner, i.status, `${i.progress}%`]))],
      { x: 0.5, y: 1.2, w: 12, fontSize: 12, color: "F0E6D2", border: { type: "solid", color: RUBINE, pt: 1 } },
    );
  }


  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
