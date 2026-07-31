import { Buffer } from "node:buffer";
import console from "node:console";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const RESULT_TITLE_PREFIX = "PORTFOLIO_BENCHMARK:";
const BENCHMARK_TIMEOUT_MILLISECONDS = 120_000;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const benchmarkSuite = process.argv[2] ?? "portfolio";
const benchmarkPaths = {
  portfolio: "/benchmarks/portfolio-lab/",
  release1: "/benchmarks/release-1/",
};
const benchmarkPath = benchmarkPaths[benchmarkSuite];
if (!benchmarkPath) {
  throw new Error(
    `Unknown benchmark suite "${benchmarkSuite}". Choose portfolio or release1.`,
  );
}

const server = await createServer({
  root: projectRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
const browserProfile = await mkdtemp(join(tmpdir(), "portfolio-benchmark-"));

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite did not expose a local benchmark port.");
  }

  const browserPath = await findBrowser();
  const benchmarkUrl = `http://127.0.0.1:${address.port}${benchmarkPath}`;
  const encodedResult = await runBenchmarkPage(
    browserPath,
    browserProfile,
    benchmarkUrl,
  );
  const report = parseReport(encodedResult);

  if ("error" in report) throw new Error(report.error);
  printReport(report);
} finally {
  await server.close();
  await rm(browserProfile, { recursive: true, force: true });
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
      // Try the next known browser location.
    }
  }

  throw new Error(
    "Chrome or Chromium was not found. Set PORTFOLIO_BENCHMARK_BROWSER to its executable.",
  );
}

async function runBenchmarkPage(browserPath, profilePath, url) {
  const browser = spawn(browserPath, [
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
  browser.stderr.setEncoding("utf8");
  browser.stderr.on("data", (chunk) => { standardError += chunk; });

  try {
    const debuggerPort = await waitForDebuggerPort(profilePath, browser);
    const page = await waitForBenchmarkTarget(debuggerPort, browser, url);
    return await waitForBenchmarkTitle(page.webSocketDebuggerUrl, browser);
  } catch (error) {
    if (browser.exitCode !== null && standardError) {
      throw new Error(`Chrome exited before the benchmark completed.\n${standardError}`);
    }
    throw error;
  } finally {
    browser.kill("SIGTERM");
    await Promise.race([once(browser, "close"), wait(2_000)]);
    if (browser.exitCode === null) browser.kill("SIGKILL");
  }
}

async function waitForDebuggerPort(profilePath, browser) {
  const portFile = join(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + BENCHMARK_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    ensureBrowserIsRunning(browser);
    try {
      const [port] = (await readFile(portFile, "utf8")).split("\n");
      if (port) return Number(port);
    } catch {
      await wait(50);
    }
  }
  throw benchmarkTimeout();
}

async function waitForBenchmarkTarget(port, browser, benchmarkUrl) {
  const deadline = Date.now() + BENCHMARK_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    ensureBrowserIsRunning(browser);
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === "page" && target.url === benchmarkUrl,
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Chrome may expose its HTTP endpoint slightly after writing the port file.
    }
    await wait(50);
  }
  throw benchmarkTimeout();
}

async function waitForBenchmarkTitle(debuggerUrl, browser) {
  const connection = await createCdpConnection(debuggerUrl);
  const deadline = Date.now() + BENCHMARK_TIMEOUT_MILLISECONDS;
  try {
    while (Date.now() < deadline) {
      ensureBrowserIsRunning(browser);
      const evaluation = await connection.call("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      const title = evaluation.result?.value;
      if (typeof title === "string" && title.startsWith(RESULT_TITLE_PREFIX)) {
        return title.slice(RESULT_TITLE_PREFIX.length);
      }
      await wait(100);
    }
  } finally {
    connection.close();
  }
  throw benchmarkTimeout();
}

function createCdpConnection(debuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new globalThis.WebSocket(debuggerUrl);
    const pendingCalls = new Map();
    let nextId = 1;

    socket.addEventListener("open", () => {
      resolve({
        call(method, params) {
          const id = nextId;
          nextId += 1;
          return new Promise((resolveCall, rejectCall) => {
            pendingCalls.set(id, { resolve: resolveCall, reject: rejectCall });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { socket.close(); },
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pendingCall = pendingCalls.get(message.id);
      if (!pendingCall) return;
      pendingCalls.delete(message.id);
      if (message.error) pendingCall.reject(new Error(message.error.message));
      else pendingCall.resolve(message.result);
    });
    socket.addEventListener("error", () => {
      reject(new Error("Could not connect to the Chrome debugging target."));
    });
  });
}

function ensureBrowserIsRunning(browser) {
  if (browser.exitCode !== null) {
    throw new Error(`Chrome exited with code ${browser.exitCode}.`);
  }
}

function benchmarkTimeout() {
  return new Error("The browser benchmark exceeded the 120-second harness timeout.");
}

function parseReport(encodedResult) {

  return JSON.parse(Buffer.from(encodedResult, "base64").toString("utf8"));
}

function printReport(report) {
  if (report.benchmark === "quant-roadmap/release-1-browser-worker@1") {
    printReleaseOneReport(report);
    return;
  }
  const durations = report.durationMilliseconds;
  console.log("Portfolio Lab browser-worker benchmark");
  console.log(
    `Scenario: ${report.scenario.cases} cases × ${report.scenario.pathsPerCase} paths × ${report.scenario.stepsPerPath} steps`,
  );
  console.log(
    `Runs: ${report.method.warmupRuns} warm-up + ${report.method.measuredRuns} measured`,
  );
  console.log(`Samples: ${durations.samples.join(", ")} ms`);
  console.log(
    `Median: ${durations.median} ms (min ${durations.minimum}, max ${durations.maximum})`,
  );
  console.log(`Browser: ${report.environment.userAgent}`);
  console.log(`Logical processors: ${report.environment.logicalProcessors}`);
  console.log(`Timing boundary: ${report.method.timingBoundary}`);
  console.log(`Measured at: ${report.measuredAt}`);
  console.log(`Raw JSON: ${JSON.stringify(report)}`);
}

function printReleaseOneReport(report) {
  console.log("Release 1 model-vertical browser-worker benchmark");
  console.log(
    `Runs per model: ${report.method.warmupRuns} warm-up + ${report.method.measuredRuns} measured`,
  );
  for (const scenario of report.scenarios) {
    console.log(
      `${scenario.label}: median ${scenario.durationMilliseconds.median} ms ` +
        `(min ${scenario.durationMilliseconds.minimum}, max ${scenario.durationMilliseconds.maximum}); ` +
        `budget ${scenario.budgetMilliseconds} ms; ${scenario.withinBudget ? "PASS" : "OVER BUDGET"}`,
    );
  }
  console.log(`Browser: ${report.environment.userAgent}`);
  console.log(`Logical processors: ${report.environment.logicalProcessors}`);
  console.log(`Timing boundary: ${report.method.timingBoundary}`);
  console.log(`Measured at: ${report.measuredAt}`);
  console.log(`Raw JSON: ${JSON.stringify(report)}`);

  if (report.scenarios.some((scenario) => !scenario.withinBudget)) {
    process.exitCode = 1;
  }
}
