export function LoadingChart({ label = "Preparing results…" }: { readonly label?: string }) {
  return (
    <div className="loading-chart" aria-label={label}>
      <div className="loading-chart__plot" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  );
}
