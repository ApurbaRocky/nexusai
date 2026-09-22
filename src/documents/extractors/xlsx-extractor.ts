/**
 * XLSX/CSV Text Extractor (Phase 3)
 * Extracts structured data from spreadsheets preserving sheets, rows, columns.
 * Allows AI queries like "What is the highest value in this dataset?"
 */
import * as XLSX from "xlsx";
import type { ExtractResult, ExtractableMime, DocumentMimeType } from "@/documents/types";
import { checkFileSignature, sanitizeExtractedText } from "@/documents/security/validation";

interface SheetData {
  sheetName: string;
  rowCount: number;
  colCount: number;
  headers: string[];
  rows: string[][];
  text: string;
  csvText: string;
}

export class XlsxExtractor {
  readonly mimeTypes: ExtractableMime[] = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
  ];

  async extract(buffer: Buffer, options?: { mime?: string; filename?: string }): Promise<ExtractResult> {
    const mime = (options?.mime as string | undefined) ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    if (mime !== "text/csv") {
      const typedMime = mime as DocumentMimeType;
      if (!checkFileSignature(buffer, typedMime)) {
        throw new Error("Invalid XLSX file signature");
      }
    }

    try {
      let workbook: XLSX.WorkBook;

      if (mime === "text/csv") {
        const csvText = buffer.toString("utf-8");
        workbook = XLSX.read(csvText, { type: "string", cellText: true, cellFormula: false });
      } else {
        workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellFormula: false });
      }

      const sheets: SheetData[] = [];
      let fullText = "";

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = this.parseSheet(worksheet, sheetName);
        sheets.push(sheetData);
        fullText += sheetData.text + "\n\n";
      }

      const pages = sheets.map((s, i) => ({
        pageNumber: i + 1,
        text: s.text,
        sheetName: s.sheetName,
        rowCount: s.rowCount,
        colCount: s.colCount,
      }));

      return {
        text: sanitizeExtractedText(fullText),
        pageCount: sheets.length,
        pages,
        usedOcr: false,
        metadata: {
          sheetCount: sheets.length,
          sheets: sheets.map(s => ({
            name: s.sheetName,
            rows: s.rowCount,
            cols: s.colCount,
            headers: s.headers,
          })),
        },
      };
    } catch (err) {
      throw new Error(`XLSX/CSV extraction failed: ${(err as Error).message}`);
    }
  }

  private parseSheet(worksheet: XLSX.WorkSheet, sheetName: string): SheetData {
    const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
    const colCount = range.e.c - range.s.c + 1;

    // Get headers from first row
    const headers: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c });
      const cell = worksheet[cellRef];
      headers.push(cell?.v ? String(cell.v).trim() : `Column ${c - range.s.c + 1}`);
    }

    // Get all rows
    const rows: string[][] = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellRef];
        row.push(cell?.v ? String(cell.v).trim() : "");
      }
      rows.push(row);
    }

    // Build text representation
    let text = `Sheet: ${sheetName}\n`;
    text += `Headers: ${headers.join(" | ")}\n`;
    text += `Rows: ${rows.length}, Columns: ${headers.length}\n\n`;

    // Add sample of data (first 20 rows for preview)
    const previewRows = rows.slice(0, 20);
    for (const row of previewRows) {
      text += row.map((v, i) => `${headers[i] ?? `Col ${i}`}: ${v}`).join(" | ") + "\n";
    }

    if (rows.length > 20) {
      text += `... and ${rows.length - 20} more rows\n`;
    }

    // CSV text for exact representation
    const csvText = XLSX.utils.sheet_to_csv(worksheet);

    return {
      sheetName,
      rowCount: rows.length + 1, // +1 for header
      colCount,
      headers,
      rows,
      text,
      csvText,
    };
  }

  // Structured query helpers for AI
  static querySheet(sheetData: SheetData, query: string): string {
    const lowerQuery = query.toLowerCase();

    // Simple query patterns
    if (lowerQuery.includes("highest") || lowerQuery.includes("max")) {
      return this.findMax(sheetData);
    }
    if (lowerQuery.includes("lowest") || lowerQuery.includes("min")) {
      return this.findMin(sheetData);
    }
    if (lowerQuery.includes("sum") || lowerQuery.includes("total")) {
      return this.findSum(sheetData);
    }
    if (lowerQuery.includes("average") || lowerQuery.includes("mean")) {
      return this.findAverage(sheetData);
    }
    if (lowerQuery.includes("count")) {
      return `Total rows: ${sheetData.rowCount - 1} (excluding header)`;
    }

    return `Sheet "${sheetData.sheetName}" has ${sheetData.rowCount - 1} rows and ${sheetData.colCount} columns. Headers: ${sheetData.headers.join(", ")}`;
  }

  private static findMax(sheet: SheetData): string {
    let maxVal = -Infinity;
    let maxCol = "";
    let maxRow = -1;

    for (let r = 0; r < sheet.rows.length; r++) {
      for (let c = 0; c < sheet.colCount; c++) {
        const val = parseFloat(sheet.rows[r][c]);
        if (!isNaN(val) && val > maxVal) {
          maxVal = val;
          maxCol = sheet.headers[c] ?? `Col ${c}`;
          maxRow = r + 1;
        }
      }
    }

    return maxVal !== -Infinity
      ? `Maximum value: ${maxVal} in column "${maxCol}" (row ${maxRow})`
      : "No numeric data found";
  }

  private static findMin(sheet: SheetData): string {
    let minVal = Infinity;
    let minCol = "";
    let minRow = -1;

    for (let r = 0; r < sheet.rows.length; r++) {
      for (let c = 0; c < sheet.colCount; c++) {
        const val = parseFloat(sheet.rows[r][c]);
        if (!isNaN(val) && val < minVal) {
          minVal = val;
          minCol = sheet.headers[c] ?? `Col ${c}`;
          minRow = r + 1;
        }
      }
    }

    return minVal !== Infinity
      ? `Minimum value: ${minVal} in column "${minCol}" (row ${minRow})`
      : "No numeric data found";
  }

  private static findSum(sheet: SheetData): string {
    const sums: Record<string, number> = {};

    for (let c = 0; c < sheet.colCount; c++) {
      let sum = 0;
      let count = 0;
      for (let r = 0; r < sheet.rows.length; r++) {
        const val = parseFloat(sheet.rows[r][c]);
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      }
      if (count > 0) {
        sums[sheet.headers[c] ?? `Col ${c}`] = sum;
      }
    }

    if (Object.keys(sums).length === 0) return "No numeric columns found";

    return Object.entries(sums)
      .map(([col, sum]) => `${col}: ${sum}`)
      .join("; ");
  }

  private static findAverage(sheet: SheetData): string {
    const avgs: Record<string, number> = {};

    for (let c = 0; c < sheet.colCount; c++) {
      let sum = 0;
      let count = 0;
      for (let r = 0; r < sheet.rows.length; r++) {
        const val = parseFloat(sheet.rows[r][c]);
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      }
      if (count > 0) {
        avgs[sheet.headers[c] ?? `Col ${c}`] = sum / count;
      }
    }

    if (Object.keys(avgs).length === 0) return "No numeric columns found";

    return Object.entries(avgs)
      .map(([col, avg]) => `${col}: ${avg.toFixed(2)}`)
      .join("; ");
  }
}

export async function extractXlsxText(buffer: Buffer, options?: { mime?: string; filename?: string }): Promise<ExtractResult> {
  const extractor = new XlsxExtractor();
  return extractor.extract(buffer, options);
}