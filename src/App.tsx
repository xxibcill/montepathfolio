import { lazy, Suspense, useEffect, useState } from "react";
import { LoadingChart } from "./components/LoadingChart";
import { LabIndex } from "./labs/LabIndex";
import { parseLabRoute, type LabRoute } from "./labs/routes";

const PortfolioProjectionLab = lazy(
  () => import("./labs/PortfolioProjectionLab"),
);
const QuantLabWorkspace = lazy(() => import("./labs/QuantLabWorkspace"));

function currentRoute(): LabRoute {
  return parseLabRoute(window.location.hash);
}

function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  if (route.kind === "home") return <LabIndex />;

  return (
    <Suspense
      fallback={
        <div className="app-shell lab-loading" role="status">
          <LoadingChart />
        </div>
      }
    >
      {route.lab === "portfolio-projection" && route.lesson === "accumulation" ? (
        <PortfolioProjectionLab />
      ) : (
        <QuantLabWorkspace
          key={`${route.lab}/${route.lesson}`}
          lab={route.lab}
          initialLessonId={route.lesson}
        />
      )}
    </Suspense>
  );
}

export default App;
