import { setTimeout as wait } from "node:timers/promises";
import { evaluate } from "./browser-session.mjs";

export async function discoverApplicationRoutes(cdp, origin) {
  await navigateAndValidate(cdp, origin);
  const defaultRoutes = await evaluate(
    cdp,
    `Array.from(document.querySelectorAll('.atlas-entry')).map((link) => link.hash)`,
  );
  const routes = new Set(defaultRoutes);
  for (const route of defaultRoutes) {
    await navigateAndValidate(cdp, origin + route);
    const chapterRoutes = await evaluate(
      cdp,
      `Array.from(document.querySelectorAll('a[href^="#/labs/"]')).map((link) => link.hash)`,
    );
    chapterRoutes.forEach((chapterRoute) => routes.add(chapterRoute));
  }
  for (const route of [...routes]) {
    await navigateAndValidate(cdp, origin + route);
    const chapterRoutes = await evaluate(
      cdp,
      `Array.from(document.querySelectorAll('.chapter-nav a')).map((link) => link.hash)`,
    );
    chapterRoutes.forEach((chapterRoute) => routes.add(chapterRoute));
  }
  for (const route of routes) {
    await navigateAndValidate(cdp, origin + route);
  }
  return routes;
}

export async function navigateAndValidate(cdp, url) {
  await cdp.call("Page.navigate", { url });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await evaluate(
      cdp,
      `({
        ready: document.readyState === 'complete',
        title: document.title,
        heading: document.querySelector('h1')?.textContent?.trim() ?? '',
        main: Boolean(document.querySelector('main')),
        fatal: Boolean(document.querySelector('.fatal-error'))
      })`,
    );
    if (state.fatal) throw new Error(`Fatal error boundary rendered at ${url}`);
    if (
      state.ready &&
      state.main &&
      state.heading &&
      state.title.includes("Montepathfolio")
    ) {
      return;
    }
    await wait(50);
  }
  throw new Error(`Route did not become ready: ${url}`);
}

export async function waitForSelector(cdp, selector) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (
      await evaluate(
        cdp,
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      )
    ) {
      return;
    }
    await wait(50);
  }
  throw new Error(`Selector did not become ready: ${selector}`);
}
