import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  shims: false,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __COOKIY_VERSION__: JSON.stringify(pkg.version),
  },
});
