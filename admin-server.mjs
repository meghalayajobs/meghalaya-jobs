import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadSiteConfig, saveSiteConfig, siteConfigPath } from "./lib/site-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const panelPath = path.join(__dirname, "admin", "panel.html");
const port = Number(process.env.PORT || 8787);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, { "content-type": contentType });
  response.end(body);
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function runGenerator() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["generate-meghalaya-jobs.mjs"], {
      cwd: __dirname,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        output: `${stdout}${stderr}`.trim()
      });
    });
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  try {
    if (request.method === "GET" && url.pathname === "/") {
      const html = await readFile(panelPath, "utf8");
      sendText(response, 200, html, "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      const config = await loadSiteConfig();
      sendJson(response, 200, { ok: true, config, configPath: siteConfigPath });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/config") {
      const rawBody = await readRequestBody(request);
      const parsed = JSON.parse(rawBody || "{}");
      const saved = await saveSiteConfig(parsed);
      sendJson(response, 200, {
        ok: true,
        config: saved,
        message: "Config saved successfully."
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      const result = await runGenerator();
      sendJson(response, result.ok ? 200 : 500, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    sendJson(response, 404, { ok: false, message: "Not found." });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error.message || "Unexpected error."
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Admin panel: http://127.0.0.1:${port}`);
  console.log(`Config file: ${siteConfigPath}`);
});
