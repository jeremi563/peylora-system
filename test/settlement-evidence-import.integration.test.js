import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ExcelJS from "exceljs";

import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "settlement-evidence-import-test-secret-at-least-32";
process.env.API_RATE_LIMIT = "1000";

test("merchant settlement evidence imports are isolated and duplicate-safe", async () => {
    const { connectDatabase, closeDatabase, getDatabasePool } = await import("../src/database.js");
    await connectDatabase();
    const pool = getDatabasePool();
    const auth = await import("../src/services/auth.service.js");
    const { default: app } = await import("../src/app.js");
    const suffix = randomUUID();
    const merchantEmail = `settlement-import-${suffix}@example.test`;
    const otherEmail = `settlement-import-other-${suffix}@example.test`;
    let server;
    let merchantId;
    let otherMerchantId;
    let importId;

    try {
        const registered = await auth.registerUser({
            name: "Settlement Import Merchant",
            businessName: "Settlement Import Shop",
            email: merchantEmail,
            password: "SettlementImportPassword!123",
            phoneNumber: "254700001234"
        });
        await auth.verifyEmail(registered.verificationToken);
        merchantId = (await pool.query(
            "SELECT id FROM merchants WHERE user_id = $1",
            [registered.user.id]
        )).rows[0].id;
        const session = await auth.authenticateUser({
            email: merchantEmail,
            password: "SettlementImportPassword!123"
        });

        const other = await auth.registerUser({
            name: "Other Settlement Merchant",
            businessName: "Other Settlement Shop",
            email: otherEmail,
            password: "SettlementImportPassword!123",
            phoneNumber: "254700001235"
        });
        await auth.verifyEmail(other.verificationToken);
        otherMerchantId = (await pool.query(
            "SELECT id FROM merchants WHERE user_id = $1",
            [other.user.id]
        )).rows[0].id;
        const otherSession = await auth.authenticateUser({
            email: otherEmail,
            password: "SettlementImportPassword!123"
        });

        const profile = await pool.query(
            `SELECT id FROM settlement_source_profiles
             WHERE code = 'PEYLORA_GENERIC_CSV_V1' AND active = true`
        );
        assert.equal(profile.rowCount, 1);

        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const headers = {
            authorization: `Bearer ${session.accessToken}`
        };
        const csv = [
            "provider_reference,transaction_date,settlement_date,gross_amount,currency,status,batch_reference,fee_amount,net_amount,bank_reference",
            `RCPT-${suffix},2026-11-01,2026-11-03,1000.00,KES,SETTLED,BATCH-${suffix},25.00,975.00,DEP-${suffix}`
        ].join("\r\n");

        const uploadCsv = (key, bytes, profileId = profile.rows[0].id) => {
            const form = new FormData();
            form.append("profileId", profileId);
            form.append("file", new Blob([bytes], { type: "text/csv" }), key);
            return fetch(`${baseUrl}/api/settlement-evidence/imports`, {
                method: "POST",
                headers,
                body: form
            });
        };

        const firstResponse = await uploadCsv(`settlement-${suffix}.csv`, csv);
        assert.equal(firstResponse.status, 201);
        const firstBody = await firstResponse.json();
        importId = firstBody.evidenceImport.id;
        assert.equal(firstBody.evidenceImport.status, "VALIDATED");

        const duplicateResponse = await uploadCsv(`settlement-copy-${suffix}.csv`, csv);
        assert.equal(duplicateResponse.status, 200);
        const duplicateBody = await duplicateResponse.json();
        assert.equal(duplicateBody.duplicate, true);
        assert.equal(duplicateBody.evidenceImport.id, importId);

        const alteredResponse = await uploadCsv(
            `settlement-altered-${suffix}.csv`,
            `${csv}\r\nRCPT-ALTERED-${suffix},2026-11-02,2026-11-04,500.00,KES,SETTLED,BATCH-${suffix},10.00,490.00,DEP-${suffix}`
        );
        assert.equal(alteredResponse.status, 201);
        const alteredBody = await alteredResponse.json();
        assert.notEqual(alteredBody.evidenceImport.id, importId);

        const changedHeaders = [
            "provider_reference,transaction_date,settlement_date,gross_amount,currency,unknown_column",
            `RCPT-BAD-${suffix},2026-11-01,2026-11-03,100.00,KES,bad`
        ].join("\r\n");
        const headerResponse = await uploadCsv(
            `settlement-bad-header-${suffix}.csv`,
            changedHeaders
        );
        assert.equal(headerResponse.status, 201);
        const headerBody = await headerResponse.json();
        assert.equal(headerBody.evidenceImport.status, "EXCEPTION");

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Settlement");
        sheet.addRow([
            "provider_reference",
            "transaction_date",
            "settlement_date",
            "gross_amount",
            "currency",
            "status",
            "batch_reference"
        ]);
        sheet.addRow([
            `RCPT-XLSX-${suffix}`,
            "2026-11-05",
            "2026-11-07",
            750,
            "KES",
            "SETTLED",
            `BATCH-XLSX-${suffix}`
        ]);
        const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
        const xlsxProfile = await pool.query(
            `SELECT id FROM settlement_source_profiles
             WHERE code = 'PEYLORA_GENERIC_XLSX_V1' AND active = true`
        );
        assert.equal(xlsxProfile.rowCount, 1);
        const xlsxForm = new FormData();
        xlsxForm.append("profileId", xlsxProfile.rows[0].id);
        xlsxForm.append(
            "file",
            new Blob([xlsxBuffer], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }),
            `settlement-${suffix}.xlsx`
        );
        const xlsxResponse = await fetch(
            `${baseUrl}/api/settlement-evidence/imports`,
            {
                method: "POST",
                headers,
                body: xlsxForm
            }
        );
        assert.equal(xlsxResponse.status, 201);
        const xlsxBody = await xlsxResponse.json();
        assert.equal(xlsxBody.evidenceImport.status, "VALIDATED");

        const badHeaderDetails = await pool.query(
            `SELECT validation_errors
             FROM settlement_evidence_imports
             WHERE id = $1`,
            [headerBody.evidenceImport.id]
        );
        assert.equal(badHeaderDetails.rows[0].validation_errors[0].code, "HEADER_VALIDATION_FAILED");

        const imports = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM settlement_evidence_imports
             WHERE merchant_id = $1`,
            [merchantId]
        );
        assert.equal(imports.rows[0].count, 4);

        const originalResponse = await fetch(
            `${baseUrl}/api/settlement-evidence/imports/${importId}`,
            { headers }
        );
        assert.equal(originalResponse.status, 200);
        const originalBody = await originalResponse.json();
        assert.equal(originalBody.rows.length, 1);
        assert.equal(
            originalBody.rows[0].normalized_values.provider_reference,
            `RCPT-${suffix}`
        );
        assert.equal(originalBody.rows[0].normalized_values.gross_amount, "1000.00");

        const crossMerchantResponse = await fetch(
            `${baseUrl}/api/settlement-evidence/imports/${importId}`,
            { headers: { authorization: `Bearer ${otherSession.accessToken}` } }
        );
        assert.equal(crossMerchantResponse.status, 404);

        const providerTransactionCount = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM provider_transactions"
        );
        assert.ok(providerTransactionCount.rows[0].count >= 0);

        const testProviderTransactions = await pool.query(
            "SELECT COUNT(*)::integer AS count FROM provider_transactions WHERE merchant_id = $1",
            [merchantId]
        );
        assert.equal(testProviderTransactions.rows[0].count, 0);
    } finally {
        if (server) {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
        if (merchantId) {
            await pool.query("DELETE FROM settlement_evidence_rows WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM settlement_evidence_imports WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM audit_logs WHERE merchant_id = $1", [merchantId]).catch(() => {});
            await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]).catch(() => {});
        }
        if (otherMerchantId) {
            await pool.query("DELETE FROM merchants WHERE id = $1", [otherMerchantId]).catch(() => {});
        }
        await pool.query("DELETE FROM users WHERE email IN ($1, $2)", [merchantEmail, otherEmail]).catch(() => {});
        await closeDatabase();
    }
});
