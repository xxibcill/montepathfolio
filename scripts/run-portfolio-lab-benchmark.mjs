import { Buffer } from "node:buffer";
import console from "node:console";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { launchBrowser } from "./browser-session.mjs";

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

  const benchmarkUrl = `http://127.0.0.1:${address.port}${benchmarkPath}`;
  const encodedResult = await runBenchmarkPage(browserProfile, benchmarkUrl);
  const report = parseReport(encodedResult);

  if ("error" in report) throw new Error(report.error);
  printReport(report);
} finally {
  await server.close();
  await rm(browserProfile, { recursive: true, force: true });
}

async function runBenchmarkPage(profilePath, url) {
  let browserSession;
  try {
    browserSession = await launchBrowser(profilePath, url, {
      targetUrl: url,
      timeoutMilliseconds: BENCHMARK_TIMEOUT_MILLISECONDS,
      captureStandardError: true,
    });
    return await waitForBenchmarkTitle(browserSession);
  } catch (error) {
    if (
      browserSession &&
      browserSession.browser.exitCode !== null &&
      browserSession.standardError
    ) {
      throw new Error(
        `Chrome exited before the benchmark completed.\n${browserSession.standardError}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await browserSession?.close();
  }
}

async function waitForBenchmarkTitle(browserSession) {
  const deadline = Date.now() + BENCHMARK_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    browserSession.ensureRunning();
    const evaluation = await browserSession.cdp.call("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    const title = evaluation.result?.value;
    if (typeof title === "string" && title.startsWith(RESULT_TITLE_PREFIX)) {
      return title.slice(RESULT_TITLE_PREFIX.length);
    }
    await wait(100);
  }
  throw benchmarkTimeout();
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
