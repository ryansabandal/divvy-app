import type { ReactNode } from "react";

// Warning shown when a frozen settlement plan no longer matches current expenses. The closing
// sentence differs per page (settle can Recalculate, view can only ask the organiser), so it's
// passed as children rather than baked in here.
export function StalePlanBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Expenses have changed since this plan was finalized — the amounts below may be out of date.{" "}
      {children}
    </div>
  );
}
