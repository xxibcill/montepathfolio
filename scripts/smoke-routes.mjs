import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { validateAccessibilityContracts } from "./accessibility-contracts.mjs";
import { launchBrowser } from "./browser-session.mjs";
import { discoverApplicationRoutes } from "./route-validation.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "montepathfolio-route-smoke-"));
const server = await createServer({
  root: projectRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});

let browserSession;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite did not expose a port.");
  }
  const origin = `http://127.0.0.1:${address.port}/`;
  browserSession = await launchBrowser(profile, origin);
  const { cdp } = browserSession;
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (event) => {
    exceptions.push(
      event.exceptionDetails?.text ?? "Uncaught browser exception",
    );
  });
  await cdp.call("Runtime.enable");
  await cdp.call("Page.enable");

  const routes = await discoverApplicationRoutes(cdp, origin);
  await validateAccessibilityContracts(cdp, origin);

  if (exceptions.length > 0) {
    throw new Error(`Browser exceptions:\n${exceptions.join("\n")}`);
  }
  process.stdout.write(
    `Validated ${routes.size + 1} routes plus hash-focus, dark-contrast, and touch-target contracts.\n`,
  );
} finally {
  await browserSession?.close();
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
