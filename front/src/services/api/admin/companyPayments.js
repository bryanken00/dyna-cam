import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// PLAN-008 phase C: the company's own Xendit account. The keys are write-only —
// replies only say { source, connected, mode, webhookUrl, sandbox, openCheckouts }.

// { payment }
export const getCompanyPaymentsApi = async () => {
  const response = await api.get("/api/v1/admin/company-payments");
  return response.data;
};

// { secretKey, callbackToken } → { payment }
export const saveCompanyPaymentsApi = async (data) => {
  const response = await api.put("/api/v1/admin/company-payments", data);
  return response.data;
};

// → { payment }
export const disconnectCompanyPaymentsApi = async () => {
  const response = await api.delete("/api/v1/admin/company-payments");
  return response.data;
};
