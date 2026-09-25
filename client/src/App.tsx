import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/shell";
import Today from "@/pages/today";
import { CalendarPage } from "@/pages/calendar";
import JournalPage from "@/pages/journal";
import { HabitsPage, FocusPage, SettingsPage, useAutoSync } from "@/pages/other";
import TasksPage from "@/pages/tasks";

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
