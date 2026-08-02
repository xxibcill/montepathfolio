import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const DEFAULT_BROWSER_TIMEOUT_MILLISECONDS = 10_000;
const BROWSER_POLL_INTERVAL_MILLISECONDS = 25;

export async function launchBrowser(
  profilePath,
  url,
  {
    targetUrl = url,
    timeoutMilliseconds = DEFAULT_BROWSER_TIMEOUT_MILLISECONDS,
    captureStandardError = false,
  } = {},
) {
  const browser = spawn(await findBrowser(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profilePath}`,
    url,
  ]);
  let standardError = "";
  if (captureStandardError) {
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", (chunk) => {
      standardError += chunk;
    });
  } else {
    browser.stderr.resume();
  }

  try {
    const port = await debuggerPort(profilePath, browser, timeoutMilliseconds);
    const target = await pageTarget(
      port,
      browser,
      targetUrl,
      timeoutMilliseconds,
    );
    const cdp = await connect(target.webSocketDebuggerUrl);
    return {
      browser,
      cdp,
      get standardError() {
        return standardError;
      },
      ensureRunning() {
        ensureRunning(browser);
      },
      async close() {
        cdp.close();
        await stopBrowser(browser);
      },
    };
  } catch (error) {
    const exitedBeforeCleanup = browser.exitCode !== null;
    await stopBrowser(browser);
    if (exitedBeforeCleanup && standardError) {
      throw new Error(
        `Chrome exited before the page became available.\n${standardError}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function evaluate(cdp, expression) {
  const response = await cdp.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
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
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next supported browser location.
    }
  }
  throw new Error(
    "Chrome or Chromium was not found. Set PORTFOLIO_BENCHMARK_BROWSER.",
  );
}

async function debuggerPort(profilePath, processHandle, timeoutMilliseconds) {
  const path = join(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    ensureRunning(processHandle);
    try {
      const [port] = (await readFile(path, "utf8")).split("\n");
      if (port) return Number(port);
    } catch {
      // Chrome is still starting.
    }
    await wait(BROWSER_POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error("Chrome did not expose its debugging port.");
}

async function pageTarget(
  port,
  processHandle,
  targetUrl,
  timeoutMilliseconds,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    ensureRunning(processHandle);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) =>
          target.type === "page" && (!targetUrl || target.url === targetUrl),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Chrome's debugging endpoint is still starting.
    }
    await wait(BROWSER_POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error(
    targetUrl
      ? `Chrome did not expose the expected page target ${targetUrl}.`
      : "Chrome did not expose a page target.",
  );
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    socket.addEventListener("open", () =>
      resolve({
        call(method, params = {}) {
          const id = nextId;
          nextId += 1;
          return new Promise((resolveCall, rejectCall) => {
            pending.set(id, { resolve: resolveCall, reject: rejectCall });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, listener) {
          listeners.set(method, listener);
        },
        close() {
          socket.close();
        },
      }),
    );
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) listeners.get(message.method)?.(message.params);
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    });
    socket.addEventListener("error", () =>
      reject(new Error("Could not connect to Chrome.")),
    );
  });
}

function ensureRunning(processHandle) {
  if (processHandle.exitCode !== null) {
    throw new Error(`Chrome exited with ${processHandle.exitCode}.`);
  }
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null) return;
  browser.kill("SIGTERM");
  await Promise.race([once(browser, "close"), wait(2_000)]);
  if (browser.exitCode === null) browser.kill("SIGKILL");
}
