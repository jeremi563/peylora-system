import { createHash } from "node:crypto";

import ExcelJS from "exceljs";

import { getDatabasePool } from "../database.js";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;

export class SettlementEvidenceValidationError extends Error {
    constructor(message, details = []) {
        super(message);
        this.name = "SettlementEvidenceValidationError";
        this.details = details;
    }
}

export class SettlementEvidenceDuplicateError extends Error {
    constructor(existingImport) {
        super("This evidence file has already been imported");
        this.name = "SettlementEvidenceDuplicateError";
        this.existingImport = existingImport;
    }
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ",") {
            row.push(field);
            field = "";
        } else if (character === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else if (character !== "\r") {
            field += character;
        }
    }

    if (quoted) {
        throw new SettlementEvidenceValidationError("CSV contains an unterminated quoted field");
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function normalizeHeader(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

function validateHeaders(profile, headers) {
    const required = profile.required_headers.map(normalizeHeader);
    const optional = profile.optional_headers.map(normalizeHeader);
    const normalized = headers.map(normalizeHeader);
    const allowed = new Set([...required, ...optional]);
    const duplicates = [...new Set(normalized.filter((header, index) =>
        normalized.indexOf(header) !== index
    ))];
    const unknown = normalized.filter((header) => header && !allowed.has(header));
    const missing = required.filter((header) => !normalized.includes(header));
    return {
        duplicateHeaders: duplicates,
        unknownHeaders: unknown,
        missingHeaders: missing,
        valid: duplicates.length === 0 && unknown.length === 0 && missing.length === 0
    };
}

function parseIsoOrUtcDate(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const date = new Date(`${text}T00:00:00Z`);
        return Number.isFinite(date.getTime()) ? text : null;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
        const [day, month, year] = text.split("/").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            date.getUTCFullYear() === year
            && date.getUTCMonth() === month - 1
            && date.getUTCDate() === day
        ) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
    }
    if (text.includes("T")) {
        const date = new Date(text);
        if (Number.isFinite(date.getTime())) {
            return date.toISOString();
        }
    }
    return null;
}

function parseDecimal(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (!/^[-+]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
    return text;
}

function normalizeRow(profile, rawValues, rowNumber) {
    const normalized = { ...rawValues };
    const errors = [];
    for (const [key, value] of Object.entries(rawValues)) {
        if (typeof value === "string" && /^[=+@]/.test(value.trim())) {
            errors.push({
                rowNumber,
                field: key,
                code: "SPREADSHEET_FORMULA_TEXT",
                message: "Formula-like text is not accepted"
            });
        }
    }

    for (const field of ["gross_amount", "fee_amount", "net_amount"]) {
        if (Object.hasOwn(rawValues, field) && rawValues[field] !== "") {
            const decimal = parseDecimal(rawValues[field]);
            if (decimal === null) {
                errors.push({
                    rowNumber,
                    field,
                    code: "INVALID_DECIMAL",
                    message: "Amount must contain at most two decimal places"
                });
            } else {
                normalized[field] = decimal;
            }
        }
    }

    for (const field of ["transaction_date", "settlement_date", "bank_value_date"]) {
        if (Object.hasOwn(rawValues, field) && rawValues[field] !== "") {
            const date = parseIsoOrUtcDate(rawValues[field]);
            if (date === null) {
                errors.push({
                    rowNumber,
                    field,
                    code: "INVALID_DATE",
                    message: "Date must use YYYY-MM-DD, DD/MM/YYYY or ISO 8601"
                });
            } else {
                normalized[field] = date;
            }
        }
    }

    if (Object.hasOwn(rawValues, "transaction_count") && rawValues.transaction_count !== "") {
        if (!/^\d+$/.test(String(rawValues.transaction_count).trim())) {
            errors.push({
                rowNumber,
                field: "transaction_count",
                code: "INVALID_INTEGER",
                message: "Transaction count must be a non-negative integer"
            });
        } else {
            normalized.transaction_count = Number(rawValues.transaction_count);
        }
    }

    if (Object.hasOwn(rawValues, "currency")) {
        const currency = String(rawValues.currency).trim().toUpperCase();
        if (!/^KES$/.test(currency)) {
            errors.push({
                rowNumber,
                field: "currency",
                code: "UNSUPPORTED_CURRENCY",
                message: "Only KES is supported"
            });
        } else {
            normalized.currency = currency;
        }
    }

    return { normalized, errors };
}

export async function listSettlementSourceProfiles() {
    const result = await getDatabasePool().query(
        `SELECT id, code, name, file_format, required_headers, optional_headers
         FROM settlement_source_profiles
         WHERE active = true
         ORDER BY code`
    );
    return result.rows;
}

async function getProfile(profileId) {
    const result = await getDatabasePool().query(
        `SELECT id, code, name, file_format, required_headers, optional_headers
         FROM settlement_source_profiles
         WHERE id = $1 AND active = true`,
        [profileId]
    );
    return result.rows[0] ?? null;
}

async function parseCsvImport(buffer) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    if (text.includes("\u0000")) {
        throw new SettlementEvidenceValidationError("CSV contains NUL bytes");
    }
    const rows = parseCsv(text);
    if (!rows.length) {
        throw new SettlementEvidenceValidationError("CSV is empty");
    }
    return {
        headers: rows[0],
        dataRows: rows.slice(1)
    };
}

async function parseXlsxImport(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    if (workbook.worksheets.length !== 1) {
        throw new SettlementEvidenceValidationError(
            "XLSX must contain exactly one worksheet",
            []
        );
    }
    const sheet = workbook.worksheets[0];
    if (sheet.rowCount < 1) {
        throw new SettlementEvidenceValidationError("XLSX worksheet is empty");
    }
    const headers = [];
    const dataRows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const values = row.values.slice(1);
        if (rowNumber === 1) {
            headers.push(...values.map((value) => String(value ?? "").trim()));
        } else {
            dataRows.push(values.map((value, columnIndex) => {
                const cell = row.getCell(columnIndex + 1);
                if (cell.type === 6) {
                    return `=${String(cell.formula ?? "")}`;
                }
                if (value && typeof value === "object" && value.result !== undefined) {
                    return String(value.result ?? "");
                }
                if (value instanceof Date) {
                    return value.toISOString().slice(0, 10);
                }
                if (typeof value === "object" && value.richText) {
                    return value.richText.map((part) => part.text).join("");
                }
                return value == null ? "" : String(value);
            }));
        }
    });
    return { headers, dataRows };
}

export async function createSettlementEvidenceImport({
    merchantId,
    operatorUserId,
    profileId,
    originalFilename,
    mimeType,
    buffer
}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new SettlementEvidenceValidationError("Evidence file is empty");
    }
    if (buffer.length > MAX_IMPORT_BYTES) {
        throw new SettlementEvidenceValidationError("Evidence file exceeds 5 MB");
    }

    const profile = await getProfile(profileId);
    if (!profile) {
        throw new SettlementEvidenceValidationError("Settlement source profile not found");
    }
    if (!originalFilename || originalFilename.length > 255) {
        throw new SettlementEvidenceValidationError("Invalid evidence filename");
    }

    const isCsv = profile.file_format === "CSV"
        && (
            mimeType === "text/csv"
            || mimeType === "application/csv"
            || mimeType === "text/plain"
        )
        && /\.csv$/i.test(originalFilename);
    const isXlsx = profile.file_format === "XLSX"
        && mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        && /\.xlsx$/i.test(originalFilename);
    if (!isCsv && !isXlsx) {
        throw new SettlementEvidenceValidationError(
            `Evidence file must match the ${profile.file_format} source profile`
        );
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const pool = getDatabasePool();
    const existing = await pool.query(
        `SELECT id, merchant_id, status, sha256, received_at
         FROM settlement_evidence_imports
         WHERE merchant_id = $1 AND sha256 = $2`,
        [merchantId, sha256]
    );
    if (existing.rowCount) {
        return {
            duplicate: true,
            import: existing.rows[0]
        };
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const parsed = profile.file_format === "CSV"
            ? await parseCsvImport(buffer)
            : await parseXlsxImport(buffer);
        if (parsed.dataRows.length > MAX_IMPORT_ROWS) {
            throw new SettlementEvidenceValidationError(
                `Evidence file exceeds ${MAX_IMPORT_ROWS} data rows`
            );
        }

        const headerValidation = validateHeaders(profile, parsed.headers);
        const importStatus = headerValidation.valid ? "VALIDATING" : "EXCEPTION";
        const importResult = await client.query(
            `INSERT INTO settlement_evidence_imports (
                merchant_id, profile_id, status, original_filename, mime_type,
                size_bytes, sha256, original_bytes, parsed_row_count,
                validation_errors
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (merchant_id, sha256) DO NOTHING
             RETURNING id, merchant_id, status, sha256, received_at`,
            [
                merchantId,
                profile.id,
                importStatus,
                originalFilename,
                mimeType,
                buffer.length,
                sha256,
                buffer,
                parsed.dataRows.length,
                JSON.stringify(headerValidation.valid ? [] : [{
                    code: "HEADER_VALIDATION_FAILED",
                    duplicateHeaders: headerValidation.duplicateHeaders,
                    unknownHeaders: headerValidation.unknownHeaders,
                    missingHeaders: headerValidation.missingHeaders
                }])
            ]
        );

        if (!importResult.rowCount) {
            await client.query("ROLLBACK");
            const duplicate = await pool.query(
                `SELECT id, merchant_id, status, sha256, received_at
                 FROM settlement_evidence_imports
                 WHERE merchant_id = $1 AND sha256 = $2`,
                [merchantId, sha256]
            );
            return { duplicate: true, import: duplicate.rows[0] };
        }

        const evidenceImport = importResult.rows[0];
        if (headerValidation.valid) {
            const allowedHeaders = [
                ...profile.required_headers,
                ...profile.optional_headers
            ].map(normalizeHeader);
            for (let index = 0; index < parsed.dataRows.length; index += 1) {
                const rowNumber = index + 2;
                const rawValues = {};
                const headerValues = parsed.headers.map(normalizeHeader);
                for (let column = 0; column < parsed.headers.length; column += 1) {
                    const header = headerValues[column];
                    if (!allowedHeaders.includes(header)) continue;
                    rawValues[header] = parsed.dataRows[index][column] == null
                        ? ""
                        : String(parsed.dataRows[index][column]);
                }
                const normalized = normalizeRow(profile, rawValues, rowNumber);
                await client.query(
                    `INSERT INTO settlement_evidence_rows (
                        import_id, merchant_id, row_number, raw_values,
                        normalized_values, validation_status, validation_errors
                     )
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        evidenceImport.id,
                        merchantId,
                        rowNumber,
                        JSON.stringify(rawValues),
                        JSON.stringify(normalized.normalized),
                        normalized.errors.length ? "EXCEPTION" : "VALID",
                        JSON.stringify(normalized.errors)
                    ]
                );
            }

            const exceptionCount = await client.query(
                `SELECT COUNT(*)::integer AS count
                 FROM settlement_evidence_rows
                 WHERE import_id = $1 AND validation_status = 'EXCEPTION'`,
                [evidenceImport.id]
            );
            const finalStatus = exceptionCount.rows[0].count ? "EXCEPTION" : "VALIDATED";
            await client.query(
                `UPDATE settlement_evidence_imports
                 SET status = $2, completed_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [evidenceImport.id, finalStatus]
            );
            evidenceImport.status = finalStatus;
        } else {
            await client.query(
                `UPDATE settlement_evidence_imports
                 SET status = 'EXCEPTION', completed_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [evidenceImport.id]
            );
        }

        await client.query(
            `INSERT INTO audit_logs (
                user_id, merchant_id, action, entity_type, entity_id, details, event_key
             )
             VALUES ($1, $2, 'SETTLEMENT_EVIDENCE_IMPORTED', 'SETTLEMENT_EVIDENCE_IMPORT', $3, $4, $5)
             ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
            [
                operatorUserId,
                merchantId,
                evidenceImport.id,
                JSON.stringify({
                    sha256,
                    originalFilename,
                    mimeType,
                    sizeBytes: buffer.length,
                    profileCode: profile.code,
                    status: evidenceImport.status
                }),
                `settlement-evidence-import:${merchantId}:${sha256}`
            ]
        );

        await client.query("COMMIT");
        return { duplicate: false, import: evidenceImport };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getSettlementEvidenceImport(merchantId, importId) {
    const result = await getDatabasePool().query(
        `SELECT i.id, i.merchant_id, i.status, i.original_filename, i.mime_type,
                i.size_bytes, i.sha256, i.parsed_row_count, i.validation_errors,
                i.received_at, i.completed_at, i.created_at, i.updated_at,
                p.code AS profile_code, p.name AS profile_name, p.file_format
         FROM settlement_evidence_imports i
         JOIN settlement_source_profiles p ON p.id = i.profile_id
         WHERE i.id = $1 AND i.merchant_id = $2`,
        [importId, merchantId]
    );
    if (!result.rowCount) return null;
    return result.rows[0];
}

export async function listSettlementEvidenceImports(merchantId) {
    const result = await getDatabasePool().query(
        `SELECT i.id, i.status, i.original_filename, i.mime_type,
                i.size_bytes, i.sha256, i.parsed_row_count,
                i.validation_errors, i.received_at, i.completed_at,
                p.code AS profile_code, p.name AS profile_name, p.file_format
         FROM settlement_evidence_imports i
         JOIN settlement_source_profiles p ON p.id = i.profile_id
         WHERE i.merchant_id = $1
         ORDER BY i.created_at DESC`,
        [merchantId]
    );
    return result.rows;
}

export async function getSettlementEvidenceRows(merchantId, importId) {
    const result = await getDatabasePool().query(
        `SELECT r.row_number, r.raw_values, r.normalized_values,
                r.validation_status, r.validation_errors, r.created_at
         FROM settlement_evidence_rows r
         JOIN settlement_evidence_imports i
           ON i.id = r.import_id AND i.merchant_id = r.merchant_id
         WHERE r.import_id = $1 AND r.merchant_id = $2
         ORDER BY r.row_number`,
        [importId, merchantId]
    );
    return result.rows;
}

export async function getSettlementEvidenceDownload(merchantId, importId) {
    const result = await getDatabasePool().query(
        `SELECT original_filename, mime_type, sha256, original_bytes
         FROM settlement_evidence_imports
         WHERE id = $1 AND merchant_id = $2`,
        [importId, merchantId]
    );
    return result.rows[0] ?? null;
}
