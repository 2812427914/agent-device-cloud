import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts"],
  format: ["esm"],
  dts: true,
  target: "node18",
  splitting: true,
  clean: true,
  outDir: "dist"
});
