import { useEffect, useRef, useState } from "react";

/**
 * Runs `load` now and every `ms` while the page is visible, never overlapping itself. Keeps the last good value;
 * resets when `key` changes.
 */
export function usePoll<T>(load: () => Promise<T>, ms: number, key: string | number | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(undefined);
    setError(undefined);
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const d = await loadRef.current();
          if (alive) {
            setData(d);
            setError(undefined);
          }
        } catch (e) {
          if (alive) setError((e as Error).message);
        }
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, ms]);

  return { data, error };
}
