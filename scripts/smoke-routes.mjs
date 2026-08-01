import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "montepathfolio-route-smoke-"));
const server = await createServer({
  root: projectRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite did not expose a port.");
  const origin = `http://127.0.0.1:${address.port}/`;
  browser = spawn(await findBrowser(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    origin,
  ]);
  browser.stderr.resume();
  const port = await debuggerPort(profile, browser);
  const target = await pageTarget(port, browser);
  const cdp = await connect(target.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (event) => {
    exceptions.push(event.exceptionDetails?.text ?? "Uncaught browser exception");
  });
  await cdp.call("Runtime.enable");
  await cdp.call("Page.enable");

  await navigateAndValidate(cdp, origin);
  const defaultRoutes = await evaluate(cdp, `Array.from(document.querySelectorAll('.atlas-entry')).map((link) => link.hash)`);
  const routes = new Set(defaultRoutes);
  for (const route of defaultRoutes) {
    await navigateAndValidate(cdp, origin + route);
    const chapterRoutes = await evaluate(cdp, `Array.from(document.querySelectorAll('a[href^="#/labs/"]')).map((link) => link.hash)`);
    chapterRoutes.forEach((chapterRoute) => routes.add(chapterRoute));
  }
  for (const route of [...routes]) {
    await navigateAndValidate(cdp, origin + route);
    const chapterRoutes = await evaluate(cdp, `Array.from(document.querySelectorAll('.chapter-nav a')).map((link) => link.hash)`);
    chapterRoutes.forEach((chapterRoute) => routes.add(chapterRoute));
  }
  for (const route of routes) await navigateAndValidate(cdp, origin + route);
  await validateAccessibilityContracts(cdp, origin);

  if (exceptions.length > 0) throw new Error(`Browser exceptions:\n${exceptions.join("\n")}`);
  process.stdout.write(`Validated ${routes.size + 1} routes plus hash-focus, dark-contrast, and touch-target contracts.\n`);
  cdp.close();
} finally {
  if (browser) {
    browser.kill("SIGTERM");
    await Promise.race([once(browser, "close"), wait(2_000)]);
    if (browser.exitCode === null) browser.kill("SIGKILL");
  }
  await server.close();
  await rm(profile, { recursive: true, force: true });
}

async function navigateAndValidate(cdp, url) {
  await cdp.call("Page.navigate", { url });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `({
      ready: document.readyState === 'complete',
      title: document.title,
      heading: document.querySelector('h1')?.textContent?.trim() ?? '',
      main: Boolean(document.querySelector('main')),
      fatal: Boolean(document.querySelector('.fatal-error'))
    })`);
    if (state.fatal) throw new Error(`Fatal error boundary rendered at ${url}`);
    if (state.ready && state.main && state.heading && state.title.includes("Montepathfolio")) return;
    await wait(50);
  }
  throw new Error(`Route did not become ready: ${url}`);
}

async function validateAccessibilityContracts(cdp, origin) {
  await navigateAndValidate(cdp, `${origin}#/labs/portfolio-projection/accumulation`);
  await evaluate(cdp, `localStorage.setItem('montepathfolio/theme', 'dark'); document.documentElement.dataset.theme = 'dark'`);
  await assertContrast(cdp, ".model-selector__option[data-selected=\"true\"]", ".model-selector__option[data-selected=\"true\"]", 4.5, "selected model label");
  await assertContrast(cdp, ".model-selector__option[data-selected=\"true\"] small", ".model-selector__option[data-selected=\"true\"]", 4.5, "selected model detail");
  await evaluate(cdp, `document.querySelector('.control__number')?.focus()`);
  await assertContrast(cdp, ".control__number", ".control__input-shell", 4.5, "focused projection input");
  await assertBorderContrast(cdp, ".control__input-shell", 3, "projection field boundary");

  await navigateAndValidate(cdp, `${origin}#/labs/risk/var-cvar`);
  await assertContrast(cdp, ".run-experiment", ".run-experiment", 4.5, "run experiment button");
  const hashFocus = await evaluate(cdp, `(() => {
    const before = location.hash;
    document.querySelector('.skip-link').click();
    return { before, after: location.hash, activeId: document.activeElement?.id };
  })()`);
  if (hashFocus.before !== hashFocus.after || hashFocus.activeId !== "lesson-results") {
    throw new Error(`In-page navigation changed the SPA route or missed focus: ${JSON.stringify(hashFocus)}`);
  }

  await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const targets = await evaluate(cdp, `Array.from(document.querySelectorAll('.theme-toggle, .icon-button, .chapter-back, .chapter-nav a')).map((element) => {
    const rect = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: rect.width, height: rect.height };
  })`);
  const undersized = targets.filter((target) => target.width < 44 || target.height < 44);
  if (undersized.length > 0) throw new Error(`Touch targets below 44px: ${JSON.stringify(undersized)}`);
  await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: false });

  await navigateAndValidate(cdp, `${origin}#/labs/risk/not-a-lesson`);
  const canonicalHash = await evaluate(cdp, "location.hash");
  if (canonicalHash !== "#/labs/risk/var-cvar") {
    throw new Error(`Unknown lesson did not canonicalize: ${canonicalHash}`);
  }
}

async function assertContrast(cdp, foregroundSelector, backgroundSelector, minimum, label) {
  const ratio = await evaluate(cdp, contrastExpression(foregroundSelector, backgroundSelector, false));
  if (ratio < minimum) throw new Error(`${label} contrast ${ratio.toFixed(2)} is below ${minimum}:1.`);
}

async function assertBorderContrast(cdp, selector, minimum, label) {
  const ratio = await evaluate(cdp, contrastExpression(selector, selector, true));
  if (ratio < minimum) throw new Error(`${label} contrast ${ratio.toFixed(2)} is below ${minimum}:1.`);
}

function contrastExpression(foregroundSelector, backgroundSelector, useBorder) {
  return `(() => {
    const foreground = getComputedStyle(document.querySelector(${JSON.stringify(foregroundSelector)}));
    const background = getComputedStyle(document.querySelector(${JSON.stringify(backgroundSelector)}));
    const pixel = (color) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (rgb) => rgb.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const left = luminance(pixel(${useBorder ? "foreground.borderBottomColor" : "foreground.color"}));
    const right = luminance(pixel(background.backgroundColor));
    return (Math.max(left, right) + .05) / (Math.min(left, right) + .05);
  })()`;
}

async function findBrowser() {
  const candidates = [
    process.env.PORTFOLIO_BENCHMARK_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* continue */ }
  }
  throw new Error("Chrome or Chromium was not found. Set PORTFOLIO_BENCHMARK_BROWSER.");
}

async function debuggerPort(profilePath, processHandle) {
  const path = join(profilePath, "DevToolsActivePort");
  for (let attempt = 0; attempt < 400; attempt += 1) {
    ensureRunning(processHandle);
    try {
      const [port] = (await readFile(path, "utf8")).split("\n");
      if (port) return Number(port);
    } catch { /* Chrome is still starting. */ }
    await wait(25);
  }
  throw new Error("Chrome did not expose its debugging port.");
}

async function pageTarget(port, processHandle) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    ensureRunning(processHandle);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* Debug HTTP endpoint is still starting. */ }
    await wait(25);
  }
  throw new Error("Chrome did not expose a page target.");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      call(method, params = {}) {
        const id = nextId++;
        return new Promise((resolveCall, rejectCall) => {
          pending.set(id, { resolve: resolveCall, reject: rejectCall });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      on(method, listener) { listeners.set(method, listener); },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) listeners.get(message.method)?.(message.params);
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome.")));
  });
}

async function evaluate(cdp, expression) {
  const response = await cdp.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

function ensureRunning(processHandle) {
  if (processHandle.exitCode !== null) throw new Error(`Chrome exited with ${processHandle.exitCode}.`);
}
