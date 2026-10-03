import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import {
    getMerchantDashboard,
    getMerchantTransactionReport
} from "../services/analytics.service.js";

export async function getDashboard(req, res) {
    try {
        const dashboard = await getMerchantDashboard(req.auth.merchantId, req.validatedQuery);
        return res.json({ success: true, dashboard });
    } catch (error) {
        console.error("Could not build merchant dashboard:", error.message);
        return res.status(500).json({ success: false, message: "Could not retrieve analytics" });
    }
}

function escapeCsv(value) {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

const reportColumns = [
    ["Transaction ID", "transaction_id"],
    ["Payment ID", "payment_id"],
    ["Reference", "reference"],
    ["Invoice Number", "invoice_number"],
    ["Status", "status"],
    ["Requested Amount", "requested_amount"],
    ["Paid Amount", "paid_amount"],
    ["Currency", "currency"],
    ["Amount Matches", "amount_matches"],
    ["Phone Number", "phone_number"],
    ["M-Pesa Receipt", "mpesa_receipt_number"],
    ["Result Code", "result_code"],
    ["Result Description", "result_description"],
    ["Created At (UTC)", "created_at"],
    ["Callback At (UTC)", "callback_received_at"]
];

function createCsv(rows) {
    const lines = [reportColumns.map(([label]) => escapeCsv(label)).join(",")];
    for (const row of rows) {
        lines.push(reportColumns.map(([, field]) => escapeCsv(row[field])).join(","));
    }
    return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
}

async function createXlsx(rows, range) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "M-Pesa Payment Management Platform";
    const sheet = workbook.addWorksheet("Transactions");
    sheet.columns = reportColumns.map(([header, key]) => ({ header, key, width: Math.max(16, header.length + 2) }));
    sheet.addRows(rows);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + reportColumns.length)}1` };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF245C4F" } };
    sheet.insertRow(1, [`Transactions report: ${range.from} to ${range.to}`]);
    sheet.mergeCells(1, 1, 1, reportColumns.length);
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.autoFilter = { from: "A2", to: `${String.fromCharCode(64 + reportColumns.length)}2` };
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function createPdf(rows, range) {
    const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
    const chunks = [];
    return new Promise((resolve, reject) => {
        document.on("data", (chunk) => chunks.push(chunk));
        document.on("error", reject);
        document.on("end", () => resolve(Buffer.concat(chunks)));
        document.fontSize(18).fillColor("#245c4f").text("Transactions Report");
        document.moveDown(0.35).fontSize(9).fillColor("#333333").text(`Period: ${range.from} to ${range.to} (UTC)`);
        document.moveDown();

        const fields = ["created_at", "reference", "invoice_number", "status", "requested_amount", "paid_amount", "mpesa_receipt_number"];
        const labels = ["Created", "Reference", "Invoice", "Status", "Requested", "Paid", "Receipt"];
        const widths = [88, 112, 98, 62, 66, 58, 103];
        const startX = document.x;
        const drawRow = (values, isHeader = false) => {
            const y = document.y;
            if (isHeader) {
                document.save().rect(startX, y - 3, widths.reduce((sum, width) => sum + width, 0), 18).fill("#245c4f").restore();
            }
            let x = startX;
            values.forEach((value, index) => {
                document.fontSize(isHeader ? 8 : 7).fillColor(isHeader ? "#ffffff" : "#222222")
                    .text(value == null ? "" : String(value).slice(0, 36), x + 3, y, {
                        width: widths[index] - 6,
                        height: 26,
                        ellipsis: true
                    });
                x += widths[index];
            });
            document.moveDown(isHeader ? 0.65 : 0.45);
        };

        drawRow(labels, true);
        for (const row of rows) {
            if (document.y > 520) {
                document.addPage();
                drawRow(labels, true);
            }
            drawRow(fields.map((field) => row[field]));
        }
        if (!rows.length) document.fontSize(10).text("No transactions found for this period.");
        document.end();
    });
}

export async function exportTransactionReport(req, res) {
    try {
        const { format, ...rangeQuery } = req.validatedQuery;
        const report = await getMerchantTransactionReport(req.auth.merchantId, rangeQuery);
        let content;
        let contentType;
        let extension;

        if (format === "xlsx") {
            content = await createXlsx(report.rows, report.range);
            contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            extension = "xlsx";
        } else if (format === "pdf") {
            content = await createPdf(report.rows, report.range);
            contentType = "application/pdf";
            extension = "pdf";
        } else {
            content = createCsv(report.rows);
            contentType = "text/csv; charset=utf-8";
            extension = "csv";
        }

        res.set({
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="transactions-${report.range.from}-to-${report.range.to}.${extension}"`,
            "Cache-Control": "private, no-store"
        });
        return res.send(content);
    } catch (error) {
        console.error("Could not export transaction report:", error.message);
        return res.status(500).json({ success: false, message: "Could not create transaction report" });
    }
}