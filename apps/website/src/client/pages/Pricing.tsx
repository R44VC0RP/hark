import type { PricingPlanDto, PricingPlansDto } from "@hark/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { staticPricingPlans, TEAM_PLAN } from "../../shared/pricing";
import { AppleButton } from "../components/AppleButton";
import { GoogleButton } from "../components/GoogleButton";
import { PAGE_COLUMN, SiteFooter, SiteHeader } from "../components/SiteChrome";
import { primaryButton, secondaryButton } from "../components/ui";
import { api } from "../lib/api";
import { signInWithApple, signInWithGoogle, useSession } from "../lib/auth";

const numberFormat = new Intl.NumberFormat("en-US");

/**
 * Included on every plan. Pro only changes what the plan rows list: iPhones,
 * `deviceIds` routing, per-minute limits and the monthly allowance.
 */
const EVERY_PLAN = ["Approval and reply prompts", "Live Activities", "Response callbacks"];

export function Pricing() {
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<PricingPlansDto>(staticPricingPlans);
  const [failed, setFailed] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getPricingPlans()
      .then((plans) => {
        if (!cancelled) setData(plans);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function upgrade() {
    setCheckoutError(null);
    setCheckoutPending(true);
    try {
      const { url } = await api.startCheckout();
      window.location.href = url;
    } catch {
      setCheckoutPending(false);
      setCheckoutError("Could not start checkout. Manage your plan from the dashboard instead.");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader current="pricing" />

      <main className={`${PAGE_COLUMN} flex-1 pt-7 pb-16 sm:pt-10`}>
        <h1 className="text-[clamp(38px,6vw,54px)] leading-[1.08] font-medium tracking-[-0.02em] text-white">
          Pricing
        </h1>
        <p className="mt-3 max-w-[30rem] text-lg leading-[1.55] text-pretty text-ink-muted">
          Start free with one iPhone and 10,000 notifications a month. Upgrade when your webhooks
          outgrow it.
        </p>

        {failed ? (
          <p className="mt-10 border-t border-line pt-8 text-ink-muted">
            Could not load plans right now. The current numbers are always listed in the{" "}
            <Link className="hark-link" to="/docs">
              docs
            </Link>
            .
          </p>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {data.plans
              .filter((plan) => !plan.id.startsWith("team"))
              .map((plan) => (
                <PlanCard key={plan.id} plan={plan}>
                  {plan.priceMonthly === 0 ? (
                    session ? (
                      <Link to="/dashboard" className={secondaryButton}>
                        Open dashboard
                      </Link>
                    ) : (
                      <SignInButtons disabled={isPending} />
                    )
                  ) : session ? (
                    <button
                      type="button"
                      onClick={() => void upgrade()}
                      disabled={checkoutPending}
                      className={primaryButton}
                    >
                      {checkoutPending ? "Opening checkout…" : "Upgrade to Pro"}
                    </button>
                  ) : (
                    <SignInButtons disabled={isPending} />
                  )}
                </PlanCard>
              ))}
            <TeamPlanCard signedIn={Boolean(session)} />
          </div>
        )}

        {checkoutError ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {checkoutError}
          </p>
        ) : null}

        <p className="mt-8 max-w-[34rem] text-sm text-ink-faint">
          Prices in USD. Cancel anytime from the dashboard. Notifications, interactive responses,
          and Live Activity updates share the same monthly allowance.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}

function TeamPlanCard({ signedIn }: { signedIn: boolean }) {
  return (
    <section
      aria-label={`${TEAM_PLAN.name} plan`}
      className="hark-glass flex flex-col rounded-3xl p-6 sm:col-span-2"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-medium text-white">{TEAM_PLAN.name}</h2>
        <p className="text-white">
          <span className="text-[28px] leading-none font-medium tracking-[-0.015em]">
            ${TEAM_PLAN.seatPriceMonthly}
          </span>
          <span className="text-sm text-ink-faint"> per seat / month</span>
        </p>
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
        {TEAM_PLAN.description} The first seat is free; each extra seat is $
        {TEAM_PLAN.seatPriceMonthly} a month.
      </p>
      <div className="mt-5 flex flex-col gap-6 border-t border-line pt-5 sm:flex-row sm:items-end sm:justify-between">
        <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {TEAM_PLAN.features.map((row) => (
            <li key={row} className="flex items-baseline gap-2.5 text-[15px] text-ink">
              <span aria-hidden="true" className="text-[13px] text-mint">
                ✓
              </span>
              {row}
            </li>
          ))}
        </ul>
        <Link className={`${secondaryButton} shrink-0`} to={signedIn ? "/dashboard" : "/docs"}>
          {signedIn ? "Create a team" : "Read about teams"}
        </Link>
      </div>
    </section>
  );
}

function SignInButtons({ disabled }: { disabled: boolean }) {
  return (
    <div className="flex w-full flex-col gap-2.5">
      <AppleButton onClick={() => void signInWithApple()} disabled={disabled} />
      <GoogleButton onClick={() => void signInWithGoogle()} disabled={disabled} />
    </div>
  );
}

function PlanCard({ plan, children }: { plan: PricingPlanDto; children: React.ReactNode }) {
  const rows = [
    plan.notificationsPerMonth === null
      ? "Unlimited notifications"
      : `${numberFormat.format(plan.notificationsPerMonth)} notifications per month`,
    plan.devices === null
      ? "Unlimited iPhones"
      : `${plan.devices} iPhone${plan.devices === 1 ? "" : "s"}`,
    `${numberFormat.format(plan.servicePerMinute)} requests/minute per service`,
    `${numberFormat.format(plan.accountPerMinute)} requests/minute per account`,
    ...(plan.deviceRouting ? ["Device routing"] : []),
    ...EVERY_PLAN,
  ];

  return (
    <section aria-label={`${plan.name} plan`} className="hark-glass flex flex-col rounded-3xl p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-medium text-white">{plan.name}</h2>
        <p className="text-white">
          <span className="text-[28px] leading-none font-medium tracking-[-0.015em]">
            ${plan.priceMonthly}
          </span>
          <span className="text-sm text-ink-faint"> / month</span>
        </p>
      </div>
      {plan.description ? (
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{plan.description}</p>
      ) : null}
      <ul className="mt-5 flex flex-col gap-2.5 border-t border-line pt-5">
        {rows.map((row) => (
          <li key={row} className="flex items-baseline gap-2.5 text-[15px] text-ink">
            <span aria-hidden="true" className="text-[13px] text-mint">
              ✓
            </span>
            {row}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-1 items-end">{children}</div>
    </section>
  );
}
