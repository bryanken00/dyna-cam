import { envAccount, isPaymentSandbox } from "../lib/payments/xendit.js";
import { decryptSecret } from "./crypto/secretBox.js";
import { selectRows } from "./dbRows.js";

/**
 * PLAN-008 phase C: each company takes online payments into its **own** Xendit
 * account. The keys live encrypted on `companies` (xenditSecretKeyEnc,
 * xenditCallbackTokenEnc — never returned by any API) and every Xendit call for a
 * booking uses its venue's company's account:
 *
 *   venue → company → { secretKey, callbackToken }
 *
 * The default company (slug "default") falls back to XENDIT_SECRET_KEY /
 * XENDIT_CALLBACK_TOKEN in back/.env until it saves its own keys — so today's
 * deployment keeps working. Other companies never use the .env keys.
 */

const DEFAULT_SLUG = "default";

/** A company row (with its encrypted keys) → the Xendit account to use, or null keys. */
const accountOf = (company) => {
  if (!company) return { companyId: null, secretKey: "", callbackToken: "", source: "none" };
  const secretKey = decryptSecret(company.xenditSecretKeyEnc) || "";
  const callbackToken = decryptSecret(company.xenditCallbackTokenEnc) || "";
  if (secretKey && callbackToken) {
    return { companyId: company.companyId, secretKey, callbackToken, mode: company.xenditMode, source: "company" };
  }
  if (company.slug === DEFAULT_SLUG) {
    const env = envAccount();
    if (env.secretKey && env.callbackToken) return { companyId: company.companyId, ...env, source: "env" };
  }
  return { companyId: company.companyId, secretKey: "", callbackToken: "", source: "none" };
};

const COMPANY_COLUMNS = `co.companyId, co.slug, co.xenditSecretKeyEnc, co.xenditCallbackTokenEnc, co.xenditMode`;

/** The Xendit account of a company. `db` = req.db or a transaction connection. */
export const paymentAccountForCompany = async (db, companyId) => {
  const rows = await selectRows(db, `SELECT ${COMPANY_COLUMNS} FROM companies co WHERE co.companyId = ? LIMIT 1`, [
    companyId,
  ]);
  return accountOf(rows[0]);
};

/** The Xendit account of a venue's company. */
export const paymentAccountForVenue = async (db, venueId) => {
  const rows = await selectRows(
    db,
    `SELECT ${COMPANY_COLUMNS} FROM venues v INNER JOIN companies co ON co.companyId = v.companyId
     WHERE v.venueId = ? LIMIT 1`,
    [venueId]
  );
  return accountOf(rows[0]);
};

/** The company (and its account) a per-company webhook URL belongs to, or null. */
export const paymentAccountForWebhookKey = async (db, webhookKey) => {
  if (!webhookKey) return null;
  const rows = await selectRows(
    db,
    `SELECT ${COMPANY_COLUMNS} FROM companies co
     WHERE co.xenditWebhookKey = ? AND co.status != 'Deleted' LIMIT 1`,
    [webhookKey]
  );
  return rows[0] ? accountOf(rows[0]) : null;
};

/** The default company's account (the legacy /webhooks/xendit URL, before it moved to its own). */
export const defaultPaymentAccount = async (db) => {
  const rows = await selectRows(db, `SELECT ${COMPANY_COLUMNS} FROM companies co WHERE co.slug = ? LIMIT 1`, [
    DEFAULT_SLUG,
  ]);
  return accountOf(rows[0]);
};

/** Can this venue take online payment (its company's Xendit, or the sandbox)? */
export const venuePaysOnline = async (db, venueId) =>
  isPaymentSandbox() || (await paymentAccountForVenue(db, venueId)).source !== "none";
