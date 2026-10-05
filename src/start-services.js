import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const services = [
    { name: "API", file: fileURLToPath(new URL("./server.js", import.meta.url)) },
    { name: "Webhook worker", file: fileURLToPath(new URL("./workers/webhook.worker.js", import.meta.url)) }
];

let stopping = false;
let exitCode = 0;
let forceStopTimer;

const children = services.map((service) => ({
    ...service,
    process: spawn(process.execPath, [service.file], {
        env: process.env,
        stdio: "inherit"
    })
}));

function finishIfStopped() {
    if (!stopping || !children.every(({ process: child }) => child.exitCode !== null || child.signalCode !== null)) {
        return;
    }

    clearTimeout(forceStopTimer);
    process.exitCode = exitCode;
}

function stopServices(signal, code = 0) {
    if (stopping) {
        if (code !== 0) exitCode = code;
        return;
    }

    stopping = true;
    exitCode = code;
    for (const { process: child } of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }

    forceStopTimer = setTimeout(() => {
        for (const { process: child } of children) {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
    }, 10_000);
    forceStopTimer.unref();
}

for (const { name, process: child } of children) {
    child.once("error", (error) => {
        console.error(`${name} could not start:`, error.message);
        stopServices("SIGTERM", 1);
    });
    child.once("exit", (code, signal) => {
        if (!stopping) {
            console.error(`${name} exited unexpectedly:`, { code, signal });
            stopServices("SIGTERM", code || 1);
        }
        finishIfStopped();
    });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => stopServices(signal));
}