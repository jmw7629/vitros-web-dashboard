import { execFileSync } from "node:child_process";

const target = "c9a480a71c4e9b84a43462ba13ae431bf17c9382";
const base = "9a59b1e028d373987050b5a42e1f1f7c5b54b6bb";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
function requireTrue(value, message) {
  if (!value) throw new Error(message);
}

const files = git("diff", "--name-only", base, target).split("\n").filter(Boolean).sort();
requireTrue(JSON.stringify(files) === JSON.stringify(["index.html", "public/manifest.webmanifest"]), `unexpected diff files: ${files.join(", ")}`);

const html = git("show", `${target}:index.html`);
requireTrue(html.includes("<title>VITROS</title>"), "VITROS title missing");
requireTrue(!html.includes("<title>My App</title>"), "placeholder title remains");
requireTrue(html.includes('rel="manifest" href="/manifest.webmanifest"'), "manifest link missing");
requireTrue(html.includes('name="theme-color" content="#0c111b"'), "theme color missing");
requireTrue(html.includes('name="apple-mobile-web-app-title" content="VITROS"'), "Apple title metadata missing");

const manifestText = git("show", `${target}:public/manifest.webmanifest`);
const manifest = JSON.parse(manifestText);
requireTrue(manifest.name === "VITROS" && manifest.short_name === "VITROS", "manifest naming invalid");
requireTrue(manifest.start_url === "/" && manifest.scope === "/" && manifest.display === "standalone", "manifest navigation/display invalid");
requireTrue(manifest.background_color === "#0c111b" && manifest.theme_color === "#0c111b", "manifest colors invalid");
requireTrue(Array.isArray(manifest.icons) && manifest.icons.length === 1 && manifest.icons[0].src === "/favicon.png", "manifest must use repository favicon only");

const diff = git("diff", base, target);
requireTrue(!/serviceWorker|service-worker|workbox|caches\.|CacheStorage/i.test(diff), "private-data caching/service-worker code introduced");
requireTrue(!/VITE_[A-Z0-9_]*(KEY|SECRET|TOKEN)|service_role/i.test(diff), "client secret pattern introduced");

console.log(`VERIFY=PASS SHA=${target}`);
