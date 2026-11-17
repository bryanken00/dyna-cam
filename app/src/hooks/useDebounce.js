import { useEffect, useState } from "react";

/**
 * Returns `value` once it has stopped changing for `delay` ms.
 *
 * For search: bind the input to the raw value so typing stays instant, and
 * give the debounced value to the query, so a request goes out when typing
 * pauses rather than on every keystroke.
 *
 *   const debouncedSearch = useDebounce(search.trim(), 300);
 */
export const useDebounce = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
};

export default useDebounce;
