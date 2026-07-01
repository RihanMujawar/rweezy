import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, args) {
  const child = spawn(npmCommand, args, {
    stdio: "inherit",
    env: process.env,
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

const children = [
  run("backend", ["--prefix", "backend", "run", "dev"]),
  run("frontend", ["--prefix", "frontend", "run", "dev"]),
  run("waapi", ["--prefix", "WAapi", "run", "start"]),
];

let stopping = false;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 150);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
