// A fake Xendit (invoices, expiry, refunds) for the online-payment tests
// (PLAN-003 Phase F/H). Point XENDIT_API_URL at its server.

import http from "node:http";

export const XENDIT_TEST_SECRET = "xnd_development_test_secret";
export const XENDIT_TEST_CALLBACK_TOKEN = "test-callback-token-0123456789";
const SECRET = XENDIT_TEST_SECRET;

/** A fake Xendit: invoices, expiry, refunds. */
export const fakeXendit = () => {
  const state = {
    invoices: new Map(), // id → invoice
    refunds: new Map(), // id → refund
    calls: [], // "METHOD path"
    refuseRefunds: false,
    count: 0,
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const read = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        resolve(text ? JSON.parse(text) : null);
      });
    });

  state.server = http.createServer(async (req, res) => {
    const body = await read(req);
    const path = req.url;
    state.calls.push(`${req.method} ${path}`);
    const auth = `Basic ${Buffer.from(`${SECRET}:`).toString("base64")}`;
    if (req.headers.authorization !== auth) {
      return json(res, 401, { error_code: "INVALID_API_KEY", message: "Invalid API key" });
    }

    if (req.method === "POST" && path === "/v2/invoices") {
      const id = `inv_${++state.count}`;
      const invoice = {
        id,
        external_id: body.external_id,
        amount: body.amount,
        currency: body.currency,
        payer_email: body.payer_email,
        description: body.description,
        invoice_duration: body.invoice_duration,
        success_redirect_url: body.success_redirect_url,
        failure_redirect_url: body.failure_redirect_url,
        status: "PENDING",
        invoice_url: `https://checkout.test/web/${id}`,
      };
      state.invoices.set(id, invoice);
      return json(res, 200, invoice);
    }
    let match = /^\/v2\/invoices\/([^/]+)$/.exec(path);
    if (req.method === "GET" && match) {
      const invoice = state.invoices.get(match[1]);
      return invoice
        ? json(res, 200, invoice)
        : json(res, 404, { error_code: "INVOICE_NOT_FOUND_ERROR", message: "Not found" });
    }
    match = /^\/invoices\/([^/]+)\/expire!$/.exec(path);
    if (req.method === "POST" && match) {
      const invoice = state.invoices.get(match[1]);
      if (!invoice || invoice.status !== "PENDING") {
        return json(res, 404, { error_code: "INVOICE_NOT_FOUND_ERROR", message: "Can't expire" });
      }
      invoice.status = "EXPIRED";
      return json(res, 200, invoice);
    }
    if (req.method === "POST" && path === "/refunds") {
      if (state.refuseRefunds) {
        return json(res, 400, {
          error_code: "REFUND_NOT_SUPPORTED",
          message: "Refund feature is not available for this payment channel.",
        });
      }
      const id = `rfd_${++state.count}`;
      const refund = { id, status: "PENDING", ...body };
      state.refunds.set(id, refund);
      return json(res, 200, refund);
    }
    match = /^\/refunds\/([^/]+)$/.exec(path);
    if (req.method === "GET" && match) {
      const refund = state.refunds.get(match[1]);
      return refund ? json(res, 200, refund) : json(res, 404, { error_code: "DATA_NOT_FOUND" });
    }
    return json(res, 404, { error_code: "NOT_FOUND", message: path });
  });

  /** The player pays (Xendit marks the invoice PAID). */
  state.pay = (id) => {
    state.invoices.get(id).status = "PAID";
  };
  return state;
};
