import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { usePoll } from "./usePoll";

/**
 * Calls load now, whenever another tablet changes an order (Socket.IO), when
 * the connection comes back, and every intervalMs in case a message was missed.
 */
export function useLiveOrders(load: () => void | Promise<void>, intervalMs = 15_000) {
  const latest = useRef(load);
  latest.current = load;
  usePoll(load, intervalMs);
  useEffect(() => {
    const socket = io({ path: "/api/socket.io" });
    socket.on("orders.changed", () => void latest.current());
    socket.io.on("reconnect", () => void latest.current());
    return () => {
      socket.disconnect();
    };
  }, []);
}
