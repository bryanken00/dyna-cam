// CR-033: the payment sandbox's test checkout — no login; the checkout's random
// ID (from the booking's checkoutUrl) is the credential. Only answers while the
// API runs with PAYMENT_SANDBOX=true (404 otherwise).
import axiosInstance from "../axios";

// → { checkout: { description, amount, currency, status, expiresAt, returnUrl } }
// status: PENDING | PAID | EXPIRED
export const getSandboxCheckoutApi = async (checkoutId) => {
  const response = await axiosInstance.get(`/api/v1/public/payment-sandbox/${checkoutId}`);
  return response.data;
};

// Pay it → { returnUrl } (the player's booking page)
export const paySandboxCheckoutApi = async (checkoutId) => {
  const response = await axiosInstance.post(`/api/v1/public/payment-sandbox/${checkoutId}/pay`);
  return response.data;
};
