import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const axeSource = await readFile(requireWeb.resolve("axe-core/axe.min.js"), "utf8");

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitFor(url, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function cdp(socket) {
  let nextId = 0;
  const pending = new Map();
  const hydrationErrors = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      const text =
        message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? "";
      if (/hydration|server rendered html|did not match/i.test(text)) hydrationErrors.push(text);
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  });
  return {
    hydrationErrors,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

const profile = await mkdtemp(join(tmpdir(), "betterbasket-axe-"));
const chromePort = await freePort();
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  await waitFor(`http://127.0.0.1:${chromePort}/json/version`);
  for (const app of ["web", "seller-portal", "admin-portal"]) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(
      process.execPath,
      [`${root}/apps/${app}/node_modules/next/dist/bin/next`, "start", "-p", String(port)],
      { cwd: `${root}/apps/${app}`, stdio: "ignore" },
    );
    try {
      await waitFor(base);
      const targetResponse = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, {
        method: "PUT",
      });
      assert.ok(targetResponse.ok);
      const target = await targetResponse.json();
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await once(socket, "open");
      try {
        const client = cdp(socket);
        await client.send("Runtime.enable");
        await client.send("Page.enable");
        const routes =
          app === "web"
            ? [
                "/",
                "/sign-up",
                "/sign-in",
                "/verify-email",
                "/email-verified",
                "/forgot-password",
                "/reset-password",
                "/account",
              ]
            : ["/"];
        for (const route of routes) {
          await client.send("Page.navigate", { url: `${base}${route}` });
          const until = Date.now() + 20_000;
          let loaded = false;
          while (Date.now() < until) {
            const state = await client.send("Runtime.evaluate", {
              expression: "({ href: location.href, ready: document.readyState })",
              returnByValue: true,
            });
            if (
              state.result.value.href === `${base}${route}` &&
              state.result.value.ready === "complete"
            ) {
              loaded = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          assert.ok(loaded, `${app}${route}: page did not finish loading`);
          const injected = await client.send("Runtime.evaluate", { expression: axeSource });
          assert.equal(
            injected.exceptionDetails,
            undefined,
            `${app}${route}: axe injection failed`,
          );
          const result = await client.send("Runtime.evaluate", {
            expression:
              "axe.run(document).then(({violations}) => violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({id:v.id, impact:v.impact, nodes:v.nodes.map(n => n.target)})))",
            awaitPromise: true,
            returnByValue: true,
          });
          assert.equal(result.exceptionDetails, undefined, `${app}${route}: axe execution failed`);
          assert.deepEqual(result.result.value, [], `${app}${route}: serious axe violations`);
          console.log(`${app}${route}: zero serious or critical axe violations`);
          if (
            app === "web" &&
            ["/sign-up", "/sign-in", "/forgot-password", "/verify-email"].includes(route)
          ) {
            const validation = await client.send("Runtime.evaluate", {
              expression: `new Promise(resolve => {
                document.querySelector('button[type="submit"]').click();
                setTimeout(() => resolve({
                  invalidEmail: !!document.querySelector('#email-error'),
                  submitted: !!document.querySelector('button[type="submit"]:disabled')
                }), 100);
              })`,
              awaitPromise: true,
              returnByValue: true,
            });
            assert.equal(
              validation.exceptionDetails,
              undefined,
              `${app}${route}: form validation failed`,
            );
            assert.deepEqual(
              validation.result.value,
              { invalidEmail: true, submitted: false },
              `${app}${route}: invalid form state`,
            );
            console.log(`${app}${route}: empty form shows field error without submitting`);
          }
        }
        assert.deepEqual(client.hydrationErrors, [], `${app}: hydration errors`);
      } finally {
        socket.close();
      }
    } finally {
      server.kill("SIGTERM");
      if (server.exitCode === null) await once(server, "exit");
    }
  }
} finally {
  chrome.kill("SIGTERM");
  if (chrome.exitCode === null) await once(chrome, "exit");
  await rm(profile, { recursive: true, force: true });
}
