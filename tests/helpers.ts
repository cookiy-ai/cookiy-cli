import { vi, type MockInstance } from "vitest";

export class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "ExitError";
  }
}

export interface TestHarness {
  exitSpy: MockInstance;
  errSpy: MockInstance;
  outSpy: MockInstance;
  /** All stderr captured up until the first process.exit call (matches production behavior). */
  stderr: () => string;
  /** Full stderr captured for the duration of the test (post-exit noise included). */
  stderrAll: () => string;
  stdout: () => string;
  exitCode: () => number | undefined;
}

export function setupHarness(): TestHarness {
  const errChunks: string[] = [];
  const outChunks: string[] = [];
  let stderrAtFirstExit: string | null = null;

  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number) => {
      if (stderrAtFirstExit === null) {
        stderrAtFirstExit = errChunks.join("\n");
      }
      throw new ExitError(code ?? 0);
    }) as never);

  const errSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      errChunks.push(args.map(String).join(" "));
    });

  const outSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      outChunks.push(args.map(String).join(" "));
    });

  return {
    exitSpy,
    errSpy,
    outSpy,
    stderr: () => stderrAtFirstExit ?? errChunks.join("\n"),
    stderrAll: () => errChunks.join("\n"),
    stdout: () => outChunks.join("\n"),
    exitCode: () => {
      const lastCall = exitSpy.mock.calls.at(-1);
      return lastCall ? (lastCall[0] as number | undefined) : undefined;
    },
  };
}

/**
 * Run a function expected to call process.exit. Returns the captured exit code,
 * or throws if the function exited normally without calling process.exit.
 */
export async function expectExit(
  fn: () => unknown | Promise<unknown>,
): Promise<number> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ExitError) return e.code;
    throw e;
  }
  throw new Error("Expected process.exit to be called, but function returned normally");
}
