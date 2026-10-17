import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { api, type Menu } from "../api";

/** The sellable menu, reloaded whenever an admin changes it or the connection comes back. */
export function useLiveMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMenu(await api.menu());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    const socket = io({ path: "/api/socket.io" });
    socket.on("menu.changed", () => void reload());
    socket.io.on("reconnect", () => void reload());
    return () => {
      socket.disconnect();
    };
  }, [reload]);

  return { menu, error, reload };
}
