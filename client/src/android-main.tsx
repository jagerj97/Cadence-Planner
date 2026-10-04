import { createRoot } from "react-dom/client";
import { installAndroidApi } from "./lib/androidApi";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/toaster";
import { PlannerProvider } from "./components/planner";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { AppRouter } from "./App";
import "./index.css";

installAndroidApi();
// The page runs up behind the phone's status bar; the app bar pads itself by its height.
try {
  const top = window.CadenceAndroid?.insetTop?.();
  if (top) document.documentElement.style.setProperty("--safe-top", `${top}px`);
} catch { /* older builds */ }
if (!window.location.hash) window.location.hash = "#/";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <PlannerProvider>
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </PlannerProvider>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>,
);
