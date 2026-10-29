"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_RECEIPT_IMAGE_BYTES, validateReceiptImage } from "@/lib/receipt-image";
import { recognizeReceiptLocally } from "@/lib/receipt-ocr";
import { parseReceiptText, type ParsedReceiptDetails } from "@/lib/receipt-parser";
import type { HouseholdCurrency } from "@/lib/types";

type ReceiptCaptureProps = {
  image: File | null;
  currency: HouseholdCurrency;
  onImageChange: (image: File | null) => void;
  onUseDetails: (details: ParsedReceiptDetails) => void;
  onCancel: () => void;
};

async function verifyImageCanOpen(file: Blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const validDimensions = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    if (!validDimensions) throw new Error("The image has no readable dimensions. Try another photo or export it as JPEG.");
    return;
  }

  const previewUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const preview = new Image();
      preview.onload = () => resolve();
      preview.onerror = () => reject(new Error("The browser could not preview this image. Try another photo or export it as JPEG."));
      preview.src = previewUrl;
    });
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReceiptCapture({ image, currency, onImageChange, onUseDetails, onCancel }: ReceiptCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const validationVersion = useRef(0);
  const ocrControllerRef = useRef<AbortController | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [validating, setValidating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Checking image…");
  const [readingReceipt, setReadingReceipt] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const imageToPreview = previewBlob ?? image;
    if (!imageToPreview) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(imageToPreview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image, previewBlob]);

  useEffect(() => () => {
    validationVersion.current += 1;
    const controller = ocrControllerRef.current;
    ocrControllerRef.current = null;
    controller?.abort();
  }, []);

  function resetOcr() {
    const controller = ocrControllerRef.current;
    ocrControllerRef.current = null;
    controller?.abort();
    setReadingReceipt(false);
    setOcrProgress(0);
    setOcrStatus("");
    setOcrError("");
  }

  async function chooseImage(file?: File) {
    if (!file) return;
    const version = ++validationVersion.current;
    setValidating(true);
    setError("");
    try {
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const imageType = validateReceiptImage(file.size, header);
      let browserPreview: Blob = file;
      if (imageType === "image/heic" || imageType === "image/heif") {
        setStatusMessage("Converting HEIC for preview…");
        const { heicTo } = await import("heic-to");
        browserPreview = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
      }
      await verifyImageCanOpen(browserPreview);
      if (version === validationVersion.current) {
        resetOcr();
        setPreviewBlob(browserPreview);
        onImageChange(file);
        void readReceipt(browserPreview);
      }
    } catch (cause) {
      if (version === validationVersion.current) {
        const message = cause instanceof Error
          ? cause.message
          : typeof cause === "string" && cause.trim()
            ? cause
            : "This image could not be opened. Try another photo.";
        setError(message);
      }
    } finally {
      if (version === validationVersion.current) {
        setValidating(false);
        setStatusMessage("Checking image…");
      }
    }
  }

  function clearImage() {
    validationVersion.current += 1;
    resetOcr();
    setError("");
    setValidating(false);
    setPreviewBlob(null);
    onImageChange(null);
  }

  async function readReceipt(imageToRead: Blob) {
    if (readingReceipt) return;
    const controller = new AbortController();
    ocrControllerRef.current = controller;
    setReadingReceipt(true);
    setOcrProgress(0);
    setOcrStatus("Starting local OCR…");
    setOcrError("");

    try {
      const text = await recognizeReceiptLocally(imageToRead, ({ status, progress }) => {
        if (ocrControllerRef.current !== controller) return;
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        setOcrProgress(percent);
        if (status.includes("core")) setOcrStatus("Loading the on-device reading engine…");
        else if (status.includes("traineddata")) setOcrStatus("Loading English reading data…");
        else if (status.includes("recognizing")) setOcrStatus("Reading receipt text…");
        else setOcrStatus("Preparing local reading…");
      }, controller.signal);

      if (ocrControllerRef.current === controller) {
        if (text.trim()) {
          const details = parseReceiptText(text, currency);
          ocrControllerRef.current = null;
          onUseDetails(details);
        } else {
          setOcrError("No readable text was found. Try a clearer, well-lit photo.");
          setOcrStatus("");
        }
      }
    } catch (cause) {
      if (ocrControllerRef.current === controller) {
        if (controller.signal.aborted) {
          setOcrStatus("Reading canceled.");
          setOcrError("Reading canceled. Try again or enter the details manually.");
        }
        else setOcrError(cause instanceof Error ? cause.message : "Could not read this receipt. Try again.");
      }
    } finally {
      if (ocrControllerRef.current === controller) {
        ocrControllerRef.current = null;
        setReadingReceipt(false);
      }
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    void chooseImage(selectedFile);
  }

  function continueManually() {
    onUseDetails({
      merchant: null,
      date: null,
      amount: null,
      category: null,
      receiptCurrency: null,
      warnings: ["Receipt details could not be read. Enter the transaction details manually."],
    });
  }

  return <section aria-label="Scan a receipt" className="motion-panel-in rounded-2xl border border-teal-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-bold">Scan receipt</h2>
        <p className="mt-1 text-sm text-slate-600">Take a photo or choose one from your device.</p>
      </div>
      <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">Cancel</button>
    </div>

    <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" aria-label="Take a receipt photo" disabled={validating || readingReceipt} onChange={handleFileChange} className="sr-only" />
    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Choose a receipt photo" disabled={validating || readingReceipt} onChange={handleFileChange} className="sr-only" />

    {image && previewUrl ? <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2 sm:max-h-[28rem]">
        {/* A local object URL is used only for this in-memory preview. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Selected receipt preview" className="max-h-96 max-w-full rounded-lg object-contain" />
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:w-44 sm:flex-col sm:items-stretch">
        <p className="w-full truncate text-xs text-slate-500" title={image.name}>{image.name} · {formatFileSize(image.size)}</p>
        <button type="button" disabled={validating || readingReceipt} onClick={() => cameraInputRef.current?.click()} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60">Retake photo</button>
        <button type="button" disabled={validating || readingReceipt} onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60">Choose another</button>
        <button type="button" disabled={validating || readingReceipt} onClick={clearImage} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60">Remove photo</button>
      </div>
    </div> : <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center sm:flex-row sm:justify-center">
      <button type="button" disabled={validating} onClick={() => cameraInputRef.current?.click()} className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60">Take photo</button>
      <button type="button" disabled={validating} onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60">Choose photo</button>
    </div>}

    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-slate-500">JPEG, PNG, WebP, or HEIC · up to {formatFileSize(MAX_RECEIPT_IMAGE_BYTES)}.</p>
      {validating && <p role="status" className="text-xs font-medium text-teal-800">{statusMessage}</p>}
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {image && previewUrl && <div className="mt-4 border-t border-slate-200 pt-4">
      {readingReceipt && <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" aria-live="polite" className="text-sm font-medium text-teal-800">{ocrStatus}</p>
          <button type="button" onClick={() => { setOcrStatus("Canceling local reading…"); ocrControllerRef.current?.abort(); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">Cancel reading</button>
        </div>
        <div role="progressbar" aria-label="Receipt text recognition progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ocrProgress} className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-teal-600 transition-[width] duration-300" style={{ width: `${ocrProgress}%` }} />
        </div>
      </div>}
      {ocrStatus && !readingReceipt && <p role="status" className="mt-2 text-sm text-teal-800">{ocrStatus}</p>}
      {ocrError && <div className="mt-3 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-800">
        <p role="alert">{ocrError}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={readingReceipt || validating} onClick={() => void readReceipt(previewBlob ?? image)} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60">Try again</button>
          <button type="button" disabled={readingReceipt || validating} onClick={continueManually} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">Enter manually</button>
        </div>
      </div>}
    </div>}
  </section>;
}
