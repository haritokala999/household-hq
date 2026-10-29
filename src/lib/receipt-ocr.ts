type ReceiptOcrProgress = { status: string; progress: number };

const MAX_OCR_DIMENSION = 2400;

function makeAbortError() {
  const error = new Error("Receipt reading canceled.");
  error.name = "AbortError";
  return error;
}

async function createOcrCanvas(image: Blob) {
  let source: CanvasImageSource;
  let sourceWidth: number;
  let sourceHeight: number;
  let bitmap: ImageBitmap | undefined;
  let objectUrl: string | undefined;

  if (typeof createImageBitmap === "function") {
    bitmap = await createImageBitmap(image);
    source = bitmap;
    sourceWidth = bitmap.width;
    sourceHeight = bitmap.height;
  } else {
    objectUrl = URL.createObjectURL(image);
    const element = new Image();
    element.src = objectUrl;
    await element.decode();
    source = element;
    sourceWidth = element.naturalWidth;
    sourceHeight = element.naturalHeight;
  }

  try {
    if (!sourceWidth || !sourceHeight) throw new Error("This photo has no readable image dimensions.");
    const scale = Math.min(1, MAX_OCR_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this image for local reading.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Runs OCR in a browser worker using only same-origin assets. */
export async function recognizeReceiptLocally(
  image: Blob,
  onProgress: (progress: ReceiptOcrProgress) => void,
  signal: AbortSignal,
) {
  if (signal.aborted) throw makeAbortError();

  const { createWorker } = await import("tesseract.js");
  if (signal.aborted) throw makeAbortError();
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let workerTerminated = false;
  const terminateWorker = async () => {
    if (!worker || workerTerminated) return;
    workerTerminated = true;
    await worker.terminate().catch(() => undefined);
  };
  const handleAbort = () => { void terminateWorker(); };
  signal.addEventListener("abort", handleAbort, { once: true });
  let canvas: HTMLCanvasElement | undefined;

  try {
    worker = await createWorker("eng", undefined, {
      workerPath: `${window.location.origin}/ocr-assets/worker.min.js`,
      corePath: `${window.location.origin}/ocr-assets/core`,
      langPath: `${window.location.origin}/ocr-assets/lang/4.0.0_best_int`,
      workerBlobURL: false,
      // Only the public OCR model is cached; receipt images and text stay transient.
      cacheMethod: "write",
      gzip: true,
      logger: ({ status, progress }) => {
        if (!signal.aborted) onProgress({ status, progress });
      },
    });
    if (signal.aborted) throw makeAbortError();

    canvas = await createOcrCanvas(image);
    if (signal.aborted) throw makeAbortError();

    const result = await worker.recognize(canvas);
    if (signal.aborted) throw makeAbortError();
    return result.data.text;
  } finally {
    signal.removeEventListener("abort", handleAbort);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    await terminateWorker();
  }
}
