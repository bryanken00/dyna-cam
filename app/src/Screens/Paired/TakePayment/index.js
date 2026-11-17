import { TakePaymentView } from "@/Screens/TakePayment";
import { useTakePayment } from "@/Screens/TakePayment/useTakePayment";
import {
  useLookupPairedPayCode,
  useRecordPairedCashPayment,
} from "@/services/requests/pairedApp";

/**
 * Take payment on a paired phone — the same flow and layout as the staff
 * screen (pay code → lookup → check → "Record ₱X cash" → done), on the
 * paired API: only this venue's clips, credited to this phone. A paired
 * phone may always record cash (the web granted that by pairing it).
 */
const PairedTakePaymentScreen = () => {
  const m = useTakePayment({
    useLookup: useLookupPairedPayCode,
    useRecord: useRecordPairedCashPayment,
    canRecord: true,
  });
  return <TakePaymentView m={m} />;
};

export default PairedTakePaymentScreen;
