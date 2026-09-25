import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect, useState, type FormEvent } from "react";
import { API_BASE, queryClient, setPreviewToken } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { PlannerProvider } from "@/components/planner";
import { Shell } from "@/components/shell";
import Today from "@/pages/today";
import { CalendarPage } from "@/pages/calendar";
import JournalPage from "@/pages/journal";
import { HabitsPage, FocusPage, SettingsPage, useAutoSync } from "@/pages/other";
import TasksPage from "@/pages/tasks";

function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "locked" | "error">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const check = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/status`);
      if (!response.ok) throw new Error("Could not reach Cadence.");
      const data = await response.json();
      setStatus(data.authenticated ? "ready" : "locked");
    } catch {
      setStatus("error");
    }
  };
  useEffect(() => { void check(); }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Could not sign in.");
      }
      const data = await response.json();
      setPreviewToken(typeof data.previewToken === "string" ? data.previewToken : null);
      setPassword("");
      queryClient.clear();
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "ready") return <>{children}</>;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5">
      <div className="card-md w-full max-w-sm space-y-5 p-7">
        <div className="text-2xl font-semibold tracking-tight">Cadence</div>
        {status === "loading" ? (
          <p className="text-sm text-muted-foreground">Opening your planner…</p>
        ) : status === "error" ? (
          <>
            <p className="text-sm text-muted-foreground">Could not connect to your planner. Please try again.</p>
            <button className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onClick={() => { setStatus("loading"); void check(); }}>Retry</button>
          </>
        ) : (
          <form onSubmit={login} className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter your access code to open your planner.</p>
            <label className="block text-sm font-medium" htmlFor="cadence-password">Access code</label>
            <input
              id="cadence-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-lg border bg-background px-3 outline-none focus:ring-2 focus:ring-primary"
              autoFocus
              required
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <button disabled={busy} type="submit" className="h-11 w-full rounded-full bg-primary font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Opening…" : "Open Cadence"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AppRouter() {
  useAutoSync();
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Today} />
        <Route path="/day/:date" component={Today} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/week" component={CalendarPage} />
        <Route path="/month" component={CalendarPage} />
        <Route path="/journal" component={JournalPage} />
        <Route path="/journal/:date" component={JournalPage} />
        <Route path="/habits" component={HabitsPage} />
        <Route path="/focus" component={FocusPage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/sync" component={SettingsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate>
          <PlannerProvider>
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </PlannerProvider>
        </AuthGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
