export function LoadingChart() {
  return (
    <div className="loading-chart" aria-label="Calculating portfolio paths">
      <div className="loading-chart__plot" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>Calculating 1,000 futures…</p>
    </div>
  );
}
