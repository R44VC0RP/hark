import { useEffect } from "react";
import { useLocation } from "react-router";
import { consumeAuthPending, trackWebEvent } from "../lib/analytics";
import { useSession } from "../lib/auth";

const trackedLocations = new Set<string>();

export function Analytics() {
  const location = useLocation();
  const { data: session } = useSession();

  useEffect(() => {
    if (trackedLocations.has(location.key)) return;
    trackedLocations.add(location.key);
    trackWebEvent("page_view", { path: location.pathname });
  }, [location.key, location.pathname]);

  useEffect(() => {
    if (!session) return;
    const provider = consumeAuthPending();
    if (!provider) return;
    trackWebEvent("auth_completed", { path: location.pathname, properties: { provider } });
  }, [location.pathname, session]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      try {
        const destination = new URL(anchor.href, window.location.href);
        if (destination.origin === window.location.origin) return;
        if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
        trackWebEvent("outbound_clicked", {
          path: location.pathname,
          properties: { destinationHost: destination.hostname },
        });
      } catch {
        // Invalid links are ignored rather than affecting navigation.
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [location.pathname]);

  return null;
}
