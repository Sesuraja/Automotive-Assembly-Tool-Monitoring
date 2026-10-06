/**
 * Aperture Automotive Assembly Tool Monitoring
 * Enterprise PDF Export Utility
 */

export interface PdfKpi {
  label: string;
  value: string;
  unit?: string;
  accent?: 'blue' | 'green' | 'amber' | 'red';
}

export interface ExportPdfOptions {
  title: string;
  subtitle: string;
  systemTime: string;
  kpis?: PdfKpi[];
  columns: string[];
  rows: (string | number)[][];
  filename?: string;
}

export function exportToProfessionalPdf(options: ExportPdfOptions): void {
  const { title, subtitle, systemTime, kpis = [], columns, rows } = options;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to export the PDF report.');
    return;
  }

  const kpisHtml =
    kpis.length > 0
      ? `
    <div class="kpi-grid">
      ${kpis
        .map(
          (k) => `
        <div class="kpi-card ${k.accent || 'blue'}">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value} ${k.unit ? `<span class="kpi-unit">${k.unit}</span>` : ''}</div>
        </div>
      `
        )
        .join('')}
    </div>
  `
      : '';

  const tableHeadersHtml = columns.map((col) => `<th>${col}</th>`).join('');
  const tableRowsHtml =
    rows.length === 0
      ? `<tr><td colspan="${columns.length}" style="text-align: center; padding: 24px; color: #94a3b8;">No records found.</td></tr>`
      : rows
        .map(
          (row) => `
        <tr>
          ${row.map((cell) => `<td>${cell !== null && cell !== undefined ? cell : '—'}</td>`).join('')}
        </tr>
      `
        )
        .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title} - Aperture</title>
  <style>
    @page {
      size: landscape;
      margin: 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 16px;
      color: #0f172a;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.4;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0284c7;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .brand-section {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-logo {
      height: 48px;
      object-fit: contain;
    }
    .brand-text h1 {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 2px 0;
      letter-spacing: -0.3px;
    }
    .brand-text .company-name {
      font-size: 13px;
      font-weight: 700;
      color: #0284c7;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .brand-text .subtext {
      font-size: 10px;
      color: #64748b;
      font-weight: 500;
    }
    .meta-section {
      text-align: right;
      font-size: 10px;
      color: #475569;
    }
    .meta-section strong {
      color: #0f172a;
    }
    .badge-classified {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      font-size: 9px;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      border: 1px solid #cbd5e1;
    }
    .report-title-bar {
      margin-bottom: 14px;
    }
    .report-title-bar h2 {
      font-size: 15px;
      font-weight: 700;
      margin: 0 0 3px 0;
      color: #0f172a;
    }
    .report-title-bar p {
      margin: 0;
      font-size: 10px;
      color: #64748b;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .kpi-card {
      padding: 8px 12px;
      border-radius: 6px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left-width: 4px;
    }
    .kpi-card.blue { border-left-color: #0284c7; }
    .kpi-card.green { border-left-color: #10b981; }
    .kpi-card.amber { border-left-color: #f59e0b; }
    .kpi-card.red { border-left-color: #ef4444; }
    .kpi-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 2px;
    }
    .kpi-value {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .kpi-unit {
      font-size: 10px;
      font-weight: 500;
      color: #64748b;
      margin-left: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 9.5px;
    }
    th {
      background: #0f172a;
      color: #ffffff;
      font-weight: 700;
      text-align: left;
      padding: 6px 8px;
      border: 1px solid #0f172a;
      text-transform: uppercase;
      font-size: 8.5px;
      letter-spacing: 0.3px;
    }
    td {
      padding: 5px 8px;
      border: 1px solid #cbd5e1;
      color: #334155;
    }
    tr:nth-child(even) {
      background-color: #f8fafc;
    }
    .footer-bar {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="brand-section">
      <img src="${window.location.origin}/aperture-logo-hd.png" alt="Aperture Logo" class="brand-logo" />
      <div class="brand-text">
        <div class="company-name">Aperture Automotive</div>
        <h1>Automotive Assembly Tool Monitoring</h1>
        <div class="subtext">Station 4A &bull; High-Frequency Vibration Telemetry & AI Diagnostic System</div>
      </div>
    </div>
    <div class="meta-section">
      <div class="badge-classified">OFFICIAL AUDIT REPORT</div>
      <div><strong>Report ID:</strong> RPT-${Date.now().toString().slice(-6)}</div>
      <div><strong>System Timestamp:</strong> ${systemTime}</div>
      <div><strong>Facility:</strong> Plant Alpha &bull; Powertrain Division</div>
    </div>
  </div>

  <div class="report-title-bar">
    <h2>${title}</h2>
    <p>${subtitle}</p>
  </div>

  ${kpisHtml}

  <table>
    <thead>
      <tr>${tableHeadersHtml}</tr>
    </thead>
    <tbody>
      ${tableRowsHtml}
    </tbody>
  </table>

  <div class="footer-bar">
    <div>&copy; ${new Date().getFullYear()} Aperture Inc. All Rights Reserved. Confidential & Proprietary.</div>
    <div>System Verified &bull; ISO 10816 Mechanical Vibration Compliance</div>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.print();
      }, 400);
    });
  </script>
</body>
</html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
