import { Link } from "react-router";
import { APP_STORE_URL, PAGE_COLUMN, SiteFooter, SiteHeader } from "../components/SiteChrome";
import { primaryButton } from "../components/ui";

const SUPPORT_EMAIL = "hark@ryan.ceo";

export function Launched() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className={`${PAGE_COLUMN} flex-1 pt-7 pb-16 sm:pt-10`}>
        <article>
          <h1 className="max-w-[16ch] text-[clamp(38px,6vw,54px)] leading-[1.08] font-medium tracking-[-0.02em] text-balance text-white">
            Hark is live on the App Store.
          </h1>
          <p className="mt-3 max-w-[30rem] text-lg leading-[1.55] text-pretty text-ink-muted">
            Everyone can now install Hark, or update to the latest release, directly from the App
            Store.
          </p>
          <p className="mt-3 text-sm text-ink-faint">
            Published <time dateTime="2026-08-01">August 1, 2026</time>
          </p>

          <section className="hark-glass mt-8 flex flex-col gap-5 rounded-3xl p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <img
                alt="Hark app icon"
                className="size-16 shrink-0 rounded-[15px]"
                height={64}
                src="/app-store-icon.png"
                width={64}
              />
              <div className="min-w-0">
                <h2 className="text-lg font-medium text-white">Hark</h2>
                <p className="mt-0.5 text-[15px] leading-relaxed text-pretty text-ink-muted">
                  Developer notifications, approvals, and Live Activities on your iPhone.
                </p>
              </div>
            </div>
            <a
              className={`${primaryButton} shrink-0`}
              href={APP_STORE_URL}
              rel="noreferrer"
              target="_blank"
            >
              Open in App Store
            </a>
          </section>

          <div className="mt-8 text-ink-muted">
            <section className="border-t border-line py-8">
              <h2 className="text-[clamp(22px,3vw,26px)] leading-[1.15] font-medium tracking-[-0.015em] text-white">
                Already have Hark?
              </h2>
              <p className="mt-1.5 max-w-[34rem] text-pretty">
                Update to the App Store version to keep receiving future Hark updates and fixes.
                Open the App Store page and tap{" "}
                <strong className="font-medium text-white">Update</strong>. If you installed a
                TestFlight build, move to the public release from the same link.
              </p>
            </section>

            <section className="border-t border-line py-8">
              <h2 className="text-[clamp(22px,3vw,26px)] leading-[1.15] font-medium tracking-[-0.015em] text-white">
                Free for personal use
              </h2>
              <p className="mt-1.5 max-w-[34rem] text-pretty">
                Hark is free for one iPhone, with approvals, Live Activities and web apps included.
                Teams that share apps and on-call pay per seat.{" "}
                <Link className="hark-link" to="/pricing">
                  See pricing
                </Link>
                .
              </p>
            </section>

            <section className="border-t border-line py-8">
              <h2 className="text-[clamp(22px,3vw,26px)] leading-[1.15] font-medium tracking-[-0.015em] text-white">
                Something not working?
              </h2>
              <p className="mt-1.5 max-w-[34rem] text-pretty">
                Email{" "}
                <a
                  className="hark-link"
                  href={`mailto:${SUPPORT_EMAIL}?subject=Hark%20App%20Store%20help`}
                >
                  {SUPPORT_EMAIL}
                </a>
                . Include your iOS version and what you expected to happen, but never send a Hark
                token or webhook URL.
              </p>
            </section>
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
