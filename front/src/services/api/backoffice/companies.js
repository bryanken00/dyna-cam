import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

/** PLAN-008 phase B: companies in the back office — /api/v1/backoffice/companies. */
const backofficeApi = () => createAxiosInstanceWithInterceptor("data", userTypeAuth.backoffice);

// { search?, status?, page, pageSize } → { companies: [{ …, counts }], stats, pagination }
export const getCompaniesApi = async (params) => {
  const response = await backofficeApi().get("/api/v1/backoffice/companies", { params });
  return response.data;
};

// → { company: { …, counts, owner } }
export const getCompanyApi = async (companyId) => {
  const response = await backofficeApi().get(`/api/v1/backoffice/companies/${companyId}`);
  return response.data;
};

// { name, slug?, contactEmail?, contactPhone?, owner: { firstName, lastName, email } }
// → { companyId, slug, owner: { email, temporaryPassword }, welcomeSent }
export const createCompanyApi = async (payload) => {
  const response = await backofficeApi().post("/api/v1/backoffice/companies", payload);
  return response.data;
};

// { name, slug?, contactEmail?, contactPhone? } → { company }
export const updateCompanyApi = async ({ companyId, data }) => {
  const response = await backofficeApi().patch(`/api/v1/backoffice/companies/${companyId}`, data);
  return response.data;
};

export const suspendCompanyApi = async (companyId) => {
  const response = await backofficeApi().post(`/api/v1/backoffice/companies/${companyId}/suspend`);
  return response.data;
};

export const reactivateCompanyApi = async (companyId) => {
  const response = await backofficeApi().post(`/api/v1/backoffice/companies/${companyId}/reactivate`);
  return response.data;
};

// → { owner: { email, temporaryPassword } }
export const resetOwnerPasswordApi = async (companyId) => {
  const response = await backofficeApi().post(
    `/api/v1/backoffice/companies/${companyId}/owner/reset-password`,
  );
  return response.data;
};

// PLAN-008 phase F: make (or remake) the company's box enroll key → { enrollKey, createdAt } — ONCE
export const generateEnrollKeyApi = async (companyId) => {
  const response = await createAxiosInstanceWithInterceptor("data", userTypeAuth.backoffice).post(
    `/api/v1/backoffice/companies/${companyId}/enroll-key`,
  );
  return response.data;
};

// PLAN-008 phase F: turn the enroll key off → { enrollKey: { on: false } }
export const turnOffEnrollKeyApi = async (companyId) => {
  const response = await createAxiosInstanceWithInterceptor("data", userTypeAuth.backoffice).delete(
    `/api/v1/backoffice/companies/${companyId}/enroll-key`,
  );
  return response.data;
};
