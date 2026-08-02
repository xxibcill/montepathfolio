import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

export async function launchBrowser(profilePath, url) {
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
  browser.stderr.resume();

  try {
    const port = await debuggerPort(profilePath, browser);
    const target = await pageTarget(port, browser);
    const cdp = await connect(target.webSocketDebuggerUrl);
    return {
      browser,
      cdp,
      async close() {
        cdp.close();
        await stopBrowser(browser);
      },
    };
  } catch (error) {
    await stopBrowser(browser);
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

async function debuggerPort(profilePath, processHandle) {
  const path = join(profilePath, "DevToolsActivePort");
  for (let attempt = 0; attempt < 400; attempt += 1) {
    ensureRunning(processHandle);
    try {
      const [port] = (await readFile(path, "utf8")).split("\n");
      if (port) return Number(port);
    } catch {
      // Chrome is still starting.
    }
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
    } catch {
      // Chrome's debugging endpoint is still starting.
    }
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
