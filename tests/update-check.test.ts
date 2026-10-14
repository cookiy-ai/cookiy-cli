import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";

const NOW = 1_720_000_000_000;

const system = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  spawn: vi.fn(),
  unref: vi.fn(),
}));

vi.mock("node:fs", () => ({ default: system }));
vi.mock("node:child_process", () => ({ spawn: system.spawn }));

// The production build injects this value; import the real module with the
// same external build input rather than mocking its internal config module.
vi.stubGlobal("__COOKIY_VERSION__", "1.0.0");
const { scheduleBackgroundUpdate } = await import("../src/update-check.js");

describe("background updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COOKIY_SKIP_UPDATE_CHECK", undefined);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    system.existsSync.mockReturnValue(false);
    system.spawn.mockReturnValue({ unref: system.unref });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(() => vi.unstubAllGlobals());

  it("does not touch the update cache or start a probe when disabled", () => {
    vi.stubEnv("COOKIY_SKIP_UPDATE_CHECK", "1");

    scheduleBackgroundUpdate();

    expect(system.existsSync).not.toHaveBeenCalled();
    expect(system.readFileSync).not.toHaveBeenCalled();
    expect(system.mkdirSync).not.toHaveBeenCalled();
    expect(system.writeFileSync).not.toHaveBeenCalled();
    expect(system.spawn).not.toHaveBeenCalled();
  });

  it("keeps the default 24-hour cache gate", () => {
    system.existsSync.mockReturnValue(true);
    system.readFileSync.mockReturnValue(String(NOW - 60_000));

    scheduleBackgroundUpdate();

    expect(system.readFileSync).toHaveBeenCalled();
    expect(system.writeFileSync).not.toHaveBeenCalled();
    expect(system.spawn).not.toHaveBeenCalled();
  });

  it("refreshes an expired cache and starts the default detached probe", () => {
    system.existsSync.mockReturnValue(true);
    system.readFileSync.mockReturnValue(String(NOW - 86_400_000));

    scheduleBackgroundUpdate();

    expect(system.writeFileSync).toHaveBeenCalledWith(expect.any(String), String(NOW));
    expect(system.spawn).toHaveBeenCalledWith(process.execPath, ["-e", expect.any(String)], {
      detached: true, stdio: "ignore", windowsHide: true,
    });
    expect(system.unref).toHaveBeenCalledOnce();
  });

  it.each(["0.9.9", "1.0.0", "1.0.1"])("the default probe installs only a newer registry version (%s)", (latest) => {
    scheduleBackgroundUpdate();

    const script = system.spawn.mock.calls[0][1][1];
    let onResponse!: (res: EventEmitter) => void;
    const request = { on: vi.fn(), destroy: vi.fn() };
    const get = vi.fn((_url: string, _options: unknown, callback: typeof onResponse) => {
      onResponse = callback;
      return request;
    });
    const unref = vi.fn();
    const install = vi.fn(() => ({ unref }));
    // Execute the actual dispatched script with only mocked registry/npm
    // boundaries. No external require, network request or install can run.
    runInNewContext(script, {
      require(name: string) {
        if (name === "https") return { get };
        if (name === "child_process") return { spawn: install };
        throw new Error(`Unexpected probe dependency: ${name}`);
      },
    }, { timeout: 1000 });
    expect(get.mock.calls[0][0]).toBe("https://registry.npmjs.org/cookiy-cli/latest");
    const response = new EventEmitter();
    onResponse(response);
    response.emit("data", JSON.stringify({ version: latest }));
    response.emit("end");

    if (latest === "1.0.1") {
      expect(install).toHaveBeenCalledWith("npm", [
        "install", "-g", "--silent", "--no-audit", "--no-fund", "cookiy-cli@1.0.1",
      ], { detached: true, stdio: "ignore", windowsHide: true });
      expect(unref).toHaveBeenCalledOnce();
    } else {
      expect(install).not.toHaveBeenCalled();
    }
  });
});
