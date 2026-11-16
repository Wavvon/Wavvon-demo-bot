import { readdirSync, readFileSync } from "node:fs";
import { extname } from "node:path";

// The page every mini-app game opens (the profile's mini_app_url): static
// files from frame/, no build step, nothing loaded from anywhere else.
const DIR = new URL("../../frame/", import.meta.url);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ws: wss:; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache",
};

const routes = {};
for (const name of readdirSync(DIR)) {
  const type = TYPES[extname(name)];
  if (!type) continue;
  const body = readFileSync(new URL(name, DIR));
  const headers = { ...HEADERS, "Content-Type": `${type}; charset=utf-8` };
  routes[name === "index.html" ? "/play/" : `/play/${name}`] = () => new Response(body, { headers });
}

export default { routes };
