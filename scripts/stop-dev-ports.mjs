import { execFileSync } from "node:child_process";
import os from "node:os";

const ports = process.argv.slice(2).map(Number).filter(Number.isFinite);
const targetPorts = ports.length > 0 ? ports : [8787, 5173, 5174];
const platform = os.platform();
const killed = new Set();

for (const port of targetPorts) {
  for (const pid of findPidsByPort(port)) {
    if (pid <= 0 || killed.has(pid)) {
      continue;
    }

    try {
      killPid(pid);
      killed.add(pid);
      console.log(`Stopped pid ${pid} on port ${port}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not stop pid ${pid} on port ${port}: ${message}`);
    }
  }
}

if (killed.size === 0) {
  console.log(`No dev server found on ports ${targetPorts.join(", ")}`);
}

function findPidsByPort(port) {
  if (platform === "win32") {
    return findWindowsPids(port);
  }

  return findUnixPids(port);
}

function findWindowsPids(port) {
  const output = run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
  ]);

  return parsePidLines(output);
}

function findUnixPids(port) {
  const lsofOutput = run("lsof", ["-ti", `tcp:${port}`]);
  if (lsofOutput.trim().length > 0) {
    return parsePidLines(lsofOutput);
  }

  const fuserOutput = run("fuser", [`${port}/tcp`]);
  return parsePidLines(fuserOutput);
}

function killPid(pid) {
  if (platform === "win32") {
    run("taskkill.exe", ["/PID", String(pid), "/F"]);
    return;
  }

  run("kill", ["-TERM", String(pid)]);
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

function parsePidLines(output) {
  return output
    .split(/\s+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}
