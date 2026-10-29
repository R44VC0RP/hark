import { useSiteTheme } from "../../lib/theme";

const BAT =
  "M32 8c2-3 4-3 5 0 3-4 9-7 15-6-3 2-4 5-3 8 3-1 7 0 10 3-5 0-8 2-10 5-2-3-6-4-9-2-2-2-5-3-8-3s-6 1-8 3c-3-2-7-1-9 2-2-3-5-5-10-5 3-3 7-4 10-3 1-3 0-6-3-8 6-1 12 2 15 6 1-3 3-3 5 0z";

/** Three bats drifting across the landing page while the Halloween theme is on. */
export function HalloweenBats() {
  if (useSiteTheme() !== "halloween") return null;
  return (
    <div aria-hidden="true" className="hark-bats">
      {[0, 1, 2].map((index) => (
        <svg
          aria-hidden="true"
          className="hark-bat"
          fill="currentColor"
          key={index}
          viewBox="0 0 64 28"
        >
          <path d={BAT} />
        </svg>
      ))}
    </div>
  );
}
