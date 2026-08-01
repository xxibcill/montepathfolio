import { lazy, Suspense, useEffect, useState } from "react";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { LoadingChart } from "./components/LoadingChart";
import { LabIndex } from "./labs/LabIndex";
import { getLab, getLesson, isKnownLesson } from "./labs/catalog";
import { labHref, parseLabRoute, type LabRoute } from "./labs/routes";

const PortfolioProjectionLab = lazy(
  () => import("./labs/PortfolioProjectionLab"),
);
const QuantLabWorkspace = lazy(() => import("./labs/QuantLabWorkspace"));

function currentRoute(): LabRoute {
  const route = parseLabRoute(window.location.hash);
  if (route.kind === "lab" && !isKnownLesson(route.lab, route.lesson)) {
    const canonical = labHref(route.lab);
    window.history.replaceState(null, "", canonical);
    return parseLabRoute(canonical);
  }
  return route;
}

function routeTitle(route: LabRoute): string {
  if (route.kind === "home") return "Montepathfolio — Quantitative Learning Atlas";
  const lab = getLab(route.lab);
  const lessonTitle =
    route.lesson === "accumulation"
      ? "Accumulation simulator"
      : getLesson(route.lab, route.lesson).title;
  return `${lessonTitle} — ${lab.title} | Montepathfolio`;
}

function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    document.title = routeTitle(route);
  }, [route]);

  const routeKey = route.kind === "home" ? "home" : `${route.lab}/${route.lesson}`;

  if (route.kind === "home") {
    return <AppErrorBoundary key={routeKey}><LabIndex /></AppErrorBoundary>;
  }

  return (
    <AppErrorBoundary key={routeKey}>
      <Suspense
        fallback={
          <div className="app-shell lab-loading" role="status">
            <LoadingChart label="Opening laboratory…" />
          </div>
        }
      >
        {route.lab === "portfolio-projection" && route.lesson === "accumulation" ? (
          <PortfolioProjectionLab />
        ) : (
          <QuantLabWorkspace
            key={routeKey}
            lab={route.lab}
            initialLessonId={route.lesson}
          />
        )}
      </Suspense>
    </AppErrorBoundary>
  );
}

export default App;
