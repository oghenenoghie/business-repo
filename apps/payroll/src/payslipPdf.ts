import { minorUnitsPerMajor } from "@bp/ledger";
import type { PayslipLine } from "@bp/rules";
import PDFDocument from "pdfkit";
import type { Employee } from "./types.js";

export interface PayslipPdfInput {
  employee: Employee;
  period: string;
  currency: string;
  gross: bigint;
  net: bigint;
  lines: PayslipLine[];
}

/** Renders a minimal, honest payslip: figures only, no branding. Amounts are minor units -> major units at the render layer only. */
export function renderPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Payslip", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Employee: ${input.employee.fullName} (${input.employee.staffNumber})`);
    doc.text(`Period: ${input.period}`);
    doc.moveDown(1);

    const format = (amount: bigint) => formatMinorUnits(amount, input.currency);

    doc.fontSize(12).text("Earnings", { underline: true });
    for (const line of input.lines.filter((l) => l.type === "earning")) {
      doc.fontSize(10).text(`${line.name}: ${format(line.amount)}`);
    }
    doc.moveDown(0.5);

    doc.fontSize(12).text("Deductions", { underline: true });
    for (const line of input.lines.filter((l) => l.type === "deduction")) {
      doc.fontSize(10).text(`${line.name}: ${format(line.amount)}`);
    }
    doc.moveDown(0.5);

    doc.fontSize(12).text("Employer Cost", { underline: true });
    for (const line of input.lines.filter((l) => l.type === "employer_liability")) {
      doc.fontSize(10).text(`${line.name}: ${format(line.amount)}`);
    }
    doc.moveDown(1);

    doc.fontSize(11).text(`Gross: ${format(input.gross)}`);
    doc.fontSize(13).text(`Net Pay: ${format(input.net)}`, { underline: true });

    doc.end();
  });
}

function formatMinorUnits(amount: bigint, currency: string): string {
  const unitsPerMajor = minorUnitsPerMajor(currency);
  const decimals = unitsPerMajor.toString().length - 1;
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const major = abs / unitsPerMajor;
  const minor = (abs % unitsPerMajor).toString().padStart(decimals, "0");
  return decimals === 0
    ? `${negative ? "-" : ""}${currency} ${major.toString()}`
    : `${negative ? "-" : ""}${currency} ${major.toString()}.${minor}`;
}
