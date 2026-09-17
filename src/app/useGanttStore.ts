import { useEffect, useState } from "react";

import { serverStore } from "../store/serverStore";
import type { GanttStore } from "../store/GanttStore";

export interface ViewerIdentity {
  email: string;
  name?: string;
}

export interface StoreContextValue {
  store: GanttStore;
  /** Kept as a union so the board shares its source with the Datadog build. */
  mode: "local" | "datadog";
  viewer: ViewerIdentity;
  viewerEmail: string;
}

/**
 * The local app runs as a single Jira user (the .env credentials), so there is no
 * sign-in step. The viewer name comes from the health check so the header avatar
 * matches the Jira account the server authenticates as.
 */
const LOCAL_VIEWER_EMAIL = "local";

export function useGanttStore(): StoreContextValue {
  const [name, setName] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void serverStore
      .getHealth()
      .then((health) => {
        if (!cancelled && health.displayName) setName(health.displayName);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    store: serverStore,
    mode: "local",
    viewer: { email: LOCAL_VIEWER_EMAIL, name },
    viewerEmail: LOCAL_VIEWER_EMAIL,
  };
}
