import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, command, args, cwd = rootDir) {
  console.log(`Starting ${label}...`);
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    cwd,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${label} stopped with signal ${signal}`);
      return;
    }
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
}

const services = [
  { name: "api-gateway", path: "services/api-gateway" },
  { name: "auth-service", path: "services/auth-service" },
  { name: "food-service", path: "services/food-service" },
  { name: "grocery-service", path: "services/grocery-service" },
  { name: "ride-service", path: "services/ride-service" },
  { name: "package-service", path: "services/package-service" },
  { name: "chat-service", path: "services/chat-service" },
  { name: "notification-service", path: "services/notification-service" },
];

const children = [
  ...services.map(s => run(s.name, "node", [path.join(s.path, "index.js")])),
  run("frontend", npmCommand, ["run", "dev"], path.join(rootDir, "frontend")),
];

let stopping = false;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("\nShutting down all services...");
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
