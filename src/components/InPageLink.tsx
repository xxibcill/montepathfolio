import type { MouseEvent, ReactNode } from "react";

function focusPageTarget(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!target) return false;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.scrollIntoView({ block: "start", behavior: "smooth" });
  target.focus({ preventScroll: true });
  return true;
}

export function InPageLink({
  targetId,
  className,
  children,
}: {
  readonly targetId: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    focusPageTarget(targetId);
  };

  return (
    <a className={className} href={`#${targetId}`} onClick={handleClick}>
      {children}
    </a>
  );
}
