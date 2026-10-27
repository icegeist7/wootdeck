// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Depth, Keyboard } from "./types.js";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class Backend extends EventEmitter {
  devices: Keyboard[] = [];
  depth = new Map<string, Depth>();
  status = "Starting hardware helper";
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private subscriptions: {serial: string; keys: number[]; allKeys?: boolean; actuation?:boolean}[] = [];
  private ready = false;
  private stopped = false;
  private lastMessage = 0;
  private watchdog?: NodeJS.Timeout;

  start(): void {
    if (this.child || this.stopped) return;
    const executable = fileURLToPath(new URL("./wootdeck-helper.exe", import.meta.url));
    const child = spawn(executable, [], { windowsHide: true, stdio: "pipe" });
    this.child = child;
    this.ready = false;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      if (line.length > 1_048_576) { child.kill(); return; }
      try { this.receive(JSON.parse(line)); }
      catch { this.emit("diagnostic", "Malformed helper response"); }
    });
    // SDK diagnostics go to stderr; never store analog frames or typed content.
    child.stderr.on("data", () => {});
    child.on("error", error => { this.status = error.message; this.emit("change"); });
    child.on("exit", () => {
      lines.close();
      this.child = undefined;
      this.ready = false;
      this.devices = [];
      this.depth.clear();
      this.status = "Hardware helper reconnecting";
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error("Hardware helper disconnected")); }
      this.pending.clear();
      this.emit("change");
      if (!this.stopped) setTimeout(() => this.start(), 1500).unref();
    });
    this.lastMessage = Date.now();
    this.watchdog ??= setInterval(() => {
      if (this.child && Date.now()-this.lastMessage > 8000) this.child.kill();
    }, 1000);
    this.watchdog.unref();
  }

  private receive(message: Record<string, any>): void {
    if (message.v !== 1) throw new Error("Unsupported helper protocol");
    this.lastMessage = Date.now();
    if (typeof message.id === "number") {
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.ok) item.resolve(message.result);
      else item.reject(new Error(String(message.error || "Hardware request failed")));
      return;
    }
    if (message.event === "hello") {
      this.ready = true; this.status = "Connected";
      void this.request("subscribe", {subscriptions: this.subscriptions}).catch(() => {});
    } else if (message.event === "devices" && Array.isArray(message.devices)) {
      this.devices = message.devices;
      this.status = this.devices.length ? "Connected" : "No Wooting keyboard connected";
      for (const [serial, depth] of this.depth) {
        if (!this.devices.some(d => d.serial === serial && d.ready && d.generation === depth.generation)) this.depth.delete(serial);
      }
    } else if (message.event === "depth") {
      for (const [serial, frame] of Object.entries(message.devices as Record<string, Omit<Depth, "sampledAt">>)) {
        this.depth.set(serial, {...frame, sampledAt: Number(message.sampledAt)});
      }
    } else if (message.event === "depthUnavailable") {
      this.depth.clear();
      this.status = String(message.error || "Analog telemetry unavailable");
    } else if (message.event === "fatal") {
      this.status = String(message.error); this.child?.kill();
    }
    this.emit("change");
  }

  request(op: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ready || !this.child) return Promise.reject(new Error(this.status));
    if (this.pending.size >= 16) return Promise.reject(new Error("Hardware request queue is busy"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Hardware request timed out; check the actual profile")); }, 5000);
      this.pending.set(id, {resolve, reject, timer});
      this.child!.stdin.write(JSON.stringify({v: 1, id, op, ...payload})+"\n", error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  subscribe(subscriptions: {serial: string; keys: number[]; allKeys?: boolean; actuation?:boolean}[]): void {
    if (JSON.stringify(this.subscriptions) === JSON.stringify(subscriptions)) return;
    this.subscriptions = subscriptions;
    this.depth.clear();
    if (this.ready) void this.request("subscribe", {subscriptions}).catch(error => this.emit("diagnostic", String(error)));
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.child?.stdin.end();
    const child = this.child;
    setTimeout(() => child?.kill(), 2000).unref();
  }
}
