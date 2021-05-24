import babel from "rollup-plugin-babel";
import typescript from "rollup-plugin-typescript";
import resolve from "rollup-plugin-node-resolve";
import commonjs from "rollup-plugin-commonjs";
import { terser } from "rollup-plugin-terser";
import { eslint } from "rollup-plugin-eslint";

export default {
  input: "src/index.ts",
  output: [
    { file: "dist/index.js", format: "iife", name: "BigoIO" },
    { file: "dist/index.esm.js", format: "esm" },
    { file: "dist/index.umd.js", format: "umd", name: "BigoIO" },
    { file: "dist/index.amd.js", format: "amd" },
    { file: "dist/index.cjs.js", format: "cjs" },
  ],

  plugins: [
    typescript(),
    resolve(),
    commonjs(),
    eslint(),
    babel({ runtimeHelpers: true }),
    terser(),
  ],
};
