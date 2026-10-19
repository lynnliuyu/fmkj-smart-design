import { spawn } from "node:child_process";

/** A private stdio session: no GUI connection, TCP port, shell, or global settings. */
export class CadcraftClient {
  constructor(executable, { timeoutMs = 55_000, spawnProcess = spawn } = {}) {
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.closed = false;
    this.ended = false;
    this.failure = null;
    this.closePromise = null;
    this.process = spawnProcess(executable, ["mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (data) => this.consume(data));
    this.process.stderr.on("data", (data) => {
      this.stderr = (this.stderr + data).slice(-16_384);
    });
    this.process.on("error", (error) =>
      this.fail(new Error(`无法启动 CADCraft CLI: ${error.message}`)),
    );
    this.process.on("exit", (code, signal) => {
      this.ended = true;
      this.fail(new Error(`CADCraft CLI 已退出 (${signal ?? code})`));
    });
    this.process.on("close", () => {
      this.ended = true;
      this.fail(new Error("CADCraft 通道已关闭"));
    });
    this.process.stdin.on("error", (error) =>
      this.fail(new Error(`CADCraft 通道关闭: ${error.message}`)),
    );
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "fmkj-local-point-map-bridge", version: "1" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return this;
  }

  send(message) {
    if (this.closed) throw new Error("CADCraft 会话已关闭");
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }

  request(method, params) {
    if (this.closed || this.failure)
      return Promise.reject(this.failure ?? new Error("CADCraft 会话已关闭"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`CADCraft 请求超时: ${method}`));
        this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.fail(error);
      }
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024 * 1024) {
      this.fail(new Error("CADCraft 响应超过 64 MiB"));
      this.close();
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.fail(new Error("CADCraft 返回非 JSON-RPC 数据"));
        this.close();
        return;
      }
      // Notifications may appear between responses. Server requests get a defined reply.
      if (typeof message.method === "string") {
        if (message.id !== undefined)
          this.send(
            message.method === "ping"
              ? { jsonrpc: "2.0", id: message.id, result: {} }
              : {
                  jsonrpc: "2.0",
                  id: message.id,
                  error: {
                    code: -32601,
                    message: "Client method not supported",
                  },
                },
          );
        continue;
      }
      const waiting = this.pending.get(message.id);
      if (!waiting) continue;
      this.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error)
        waiting.reject(
          new Error(
            `CADCraft: ${message.error.message ?? JSON.stringify(message.error)}`,
          ),
        );
      else if (!("result" in message))
        waiting.reject(new Error("CADCraft JSON-RPC 响应缺少 result"));
      else waiting.resolve(message.result);
    }
  }

  fail(error) {
    this.failure ??= error;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  async tool(name, args = {}) {
    const value = await this.request("tools/call", { name, arguments: args });
    if (value?.isError)
      throw new Error(
        `CADCraft ${name}: ${
          value.content
            ?.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(" ") ?? "工具执行失败"
        }`,
      );
    const texts = value?.content?.filter((part) => part.type === "text") ?? [];
    if (texts.length === 1) {
      try {
        return JSON.parse(texts[0].text);
      } catch {
        return texts[0].text;
      }
    }
    return value;
  }

  execute(command, params = {}) {
    return this.tool("execute", { command, params });
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.fail(new Error("CADCraft 会话已关闭"));
    this.process.stdin.destroy();
    // ENOENT has no child PID and may emit close without an exit event.
    if (
      this.ended ||
      !this.process.pid ||
      this.process.exitCode !== null ||
      this.process.signalCode !== null
    )
      return;
    this.closePromise = new Promise((resolve) => {
      let settled = false;
      let killTimer;
      let finalTimer;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(finalTimer);
        this.process.removeListener("exit", done);
        this.process.removeListener("close", done);
        resolve();
      };
      this.process.once("exit", done);
      this.process.once("close", done);
      killTimer = setTimeout(() => this.process.kill("SIGKILL"), 1500);
      finalTimer = setTimeout(done, 2000);
      this.process.kill("SIGTERM");
    });
    return this.closePromise;
  }
}
