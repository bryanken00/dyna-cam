import { useEffect, useState } from "react";
import dayjs from "dayjs";

import { manilaNow } from "../../../../utils/dynaCam";

/** CR-038: the time at the venue (Manila), "10:42 AM", ticking every 15 s. */
const BoardClock = () => {
  const [now, setNow] = useState(() => manilaNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(manilaNow()), 15 * 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontSize: "clamp(28px, 3.2vw, 52px)",
        fontWeight: 600,
        letterSpacing: "-0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {dayjs(`${now.date} ${now.time}`).format("h:mm A")}
    </span>
  );
};

export default BoardClock;
