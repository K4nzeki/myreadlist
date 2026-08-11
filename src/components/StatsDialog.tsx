import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { TYPES, STATUSES, STATUS_FILL, localDayKey, DAY_LABEL } from "@/routes/shared";
import type { EntryType, EntryStatus } from "@/routes/shared";

export default function StatsDialog({
  userId,
  stats,
  onClose,
}: {
  userId: string;
  stats: { chapters: number; total: number; rereads: number; types: Record<EntryType, number>; statuses: Record<EntryStatus, number>; matrix: Record<EntryType, Record<EntryStatus, number>> };
  onClose: () => void;
}) {
  const [statsOpen, setStatsOpen] = useState(true);

  const [daily, setDaily] = useState<{ day: string; label: string; chapters: number }[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const WINDOW = 14; // last 14 days, including today
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (WINDOW - 1));
      const startKey = localDayKey(start);

      const { data, error } = await supabase
        .from("chapter_log")
        .select("day, delta")
        .eq("user_id", userId)
        .gte("day", startKey)
        .order("day", { ascending: true });
      if (!active) return;
      if (error) console.error("[Panels database] Loading chapters-read stats failed:", error);

      // Sum chapters per day rather than counting rows — a single day can
      // have several log entries (multiple titles, or several +1s).
      const totals = new Map<string, number>();
      for (const row of data ?? []) {
        totals.set(row.day, (totals.get(row.day) ?? 0) + (row.delta ?? 0));
      }

      const series: { day: string; label: string; chapters: number }[] = [];
      for (let i = WINDOW - 1; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const key = localDayKey(d);
        series.push({
          day: key,
          label: DAY_LABEL.format(d),
          // Days with no chapters read render as 0, so the chart always
          // shows a full, continuous 14-day window.
          chapters: totals.get(key) ?? 0,
        });
      }
      setDaily(series);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const dailyTotal = daily.reduce((sum, d) => sum + d.chapters, 0);
  const dailyAverage = daily.length ? dailyTotal / daily.length : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4">
      <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto scroll-touch flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Statistics</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Chapters read, last 14 days */}
        <div className="border border-border rounded-md p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-xs text-muted-foreground">Chapters read — last 14 days</div>
            <div className="text-sm font-semibold flex items-baseline gap-2">
              <span>
                {dailyTotal.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">total</span>
              </span>
              <span>
                {dailyAverage.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                  minimumFractionDigits: 1,
                })}{" "}
                <span className="text-xs font-normal text-muted-foreground">avg/day</span>
              </span>
            </div>
          </div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                />
                <Bar dataKey="chapters" name="Chapters read" fill="var(--primary)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Oldest on the left, latest on the right. Days with no chapters read show as 0.
          </p>
        </div>

        {/* Status-by-type chart */}
        <div className="border border-border rounded-md p-3 space-y-2">
          <div className="text-xs text-muted-foreground">Titles by type & status</div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={TYPES.map((t) => ({ type: t, ...stats.matrix[t] }))}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="type" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {STATUSES.map((s) => (
                  <Bar key={s} dataKey={s} stackId="a" fill={STATUS_FILL[s]} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status-by-type breakdown */}
        <div className="border border-border rounded-md p-3 space-y-2">
          <button
            type="button"
            onClick={() => setStatsOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {statsOpen ? "▾" : "▸"} Status by type
          </button>
          {statsOpen && (
            <div className="overflow-x-auto">
              <table className="text-xs min-w-[360px] w-full">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-2 py-1">Type</th>
                    {STATUSES.map((s) => (
                      <th key={s} className="text-right font-medium px-2 py-1">
                        {s}
                      </th>
                    ))}
                    <th className="text-right font-medium px-2 py-1">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {TYPES.map((t) => (
                    <tr key={t} className="border-t border-border">
                      <td className="px-2 py-1 font-medium">{t}</td>
                      {STATUSES.map((s) => (
                        <td key={s} className="px-2 py-1 text-right tabular-nums">
                          {stats.matrix[t][s]}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-semibold">{stats.types[t]}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border text-muted-foreground">
                    <td className="px-2 py-1 font-medium">All</td>
                    {STATUSES.map((s) => (
                      <td key={s} className="px-2 py-1 text-right tabular-nums">
                        {stats.statuses[s]}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">{stats.total}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
