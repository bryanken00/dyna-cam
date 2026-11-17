import StatusDot from "./StatusDot";
import { PAYMENT_STATUS_TONE, formatPeso } from "../utils/dynaCam";

/**
 * A clip's payment state: "Free", "Unpaid · ₱50" or "Paid · ₱50".
 *
 * @param {"Free"|"Unpaid"|"Paid"} paymentStatus
 * @param {number} [price]
 */
const PaymentStatusChip = ({ paymentStatus, price }) => {
  if (!paymentStatus) {
    return <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>—</span>;
  }
  const showPrice = paymentStatus !== "Free" && Number(price) > 0;
  return (
    <StatusDot tone={PAYMENT_STATUS_TONE[paymentStatus] || "muted"}>
      <span className="whitespace-nowrap">
        {paymentStatus}
        {showPrice && (
          <span style={{ color: "var(--color-text-muted)" }}>
            {" · "}
            {formatPeso(price)}
          </span>
        )}
      </span>
    </StatusDot>
  );
};

export default PaymentStatusChip;
