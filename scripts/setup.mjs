import { access, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runCommand(args, options = {}) {
  const cwd = options.cwd ?? rootDir;
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      stdio: "inherit",
      cwd,
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`command terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`command failed: ${npmCommand} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyMissing(source, target) {
  if (await exists(target)) {
    console.log(`Skipping existing file: ${path.relative(rootDir, target)}`);
    return;
  }

  if (!(await exists(source))) {
    console.warn(`Missing example file: ${path.relative(rootDir, source)}. Create ${path.relative(rootDir, target)} manually.`);
    return;
  }

  await copyFile(source, target);
  console.log(`Created ${path.relative(rootDir, target)} from ${path.relative(rootDir, source)}.`);
}

async function main() {
  console.log("\nRweezy setup starting...\n");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (Number.isNaN(nodeMajor) || nodeMajor < 20) {
    throw new Error("Node.js 20 or newer is required. Install Node 20+ and retry.");
  }

  console.log("1) Installing root dependencies...");
  await runCommand(["install"]);

  console.log("\n2) Installing backend dependencies...");
  await runCommand(["install"], { cwd: backendDir });

  console.log("\n3) Installing frontend dependencies...");
  await runCommand(["install"], { cwd: frontendDir });

  console.log("\n4) Creating environment files if needed...");
  await copyMissing(path.join(rootDir, ".env.example"), path.join(rootDir, ".env"));
  await copyMissing(path.join(backendDir, ".env.example"), path.join(backendDir, ".env"));

  console.log("\n5) Running Prisma migrations in backend...");
  await runCommand(["exec", "prisma", "migrate", "dev", "--name", "init"], { cwd: backendDir });

  console.log("\nSetup complete. Next steps:");
  console.log("- Review and populate .env and backend/.env with your real values.");
  console.log("- Start development with: npm run dev");
  console.log("- Use npm run setup again if you need to recreate env files or reinstall dependencies.");
}

main().catch((error) => {
  console.error("\nSetup failed:", error.message);
  process.exit(1);
});
