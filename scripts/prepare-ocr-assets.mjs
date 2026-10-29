import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptDirectory = new URL(".", import.meta.url);
const projectRoot = new URL("../", scriptDirectory);
const publicRoot = new URL("public/ocr-assets/", projectRoot);
const coreSource = new URL("node_modules/tesseract.js-core/", projectRoot);
const workerSource = new URL("node_modules/tesseract.js/dist/worker.min.js", projectRoot);
const englishModelSource = new URL(
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  projectRoot,
);

await rm(publicRoot, { recursive: true, force: true });
await mkdir(new URL("core/", publicRoot), { recursive: true });
await mkdir(new URL("lang/4.0.0_best_int/", publicRoot), { recursive: true });
await copyFile(workerSource, new URL("worker.min.js", publicRoot));

const coreFiles = [
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
];

await Promise.all(coreFiles.map((file) =>
  copyFile(new URL(file, coreSource), new URL(`core/${file}`, publicRoot)),
));
await copyFile(
  englishModelSource,
  new URL("lang/4.0.0_best_int/eng.traineddata.gz", publicRoot),
);

console.log(`Prepared local OCR assets in ${fileURLToPath(publicRoot)}`);
