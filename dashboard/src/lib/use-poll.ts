"use client";
import { useEffect, useState } from "react";
import { api, liveApi } from "./api";

export interface Poll<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** GET an admin REST path every `ms`. In mock mode (no backend) it stays idle with data=null. */
export function usePoll<T>(path: string, ms = 3000): Poll<T> {
  const [st, setSt] = useState<Poll<T>>({ data: null, error: null, loading: liveApi });
  useEffect(() => {
    if (!liveApi) return;
    let stop = false;
    const tick = async () => {
      try {
        const d = await api.get<T>(path);
        if (!stop) setSt({ data: d, error: null, loading: false });
      } catch (e) {
        if (!stop) setSt((p) => ({ data: p.data, error: e instanceof Error ? e.message : String(e), loading: false }));
      }
    };
    void tick();
    const id = setInterval(tick, ms);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [path, ms]);
  return st;
}
