// TYPOGRAPHY, in one place. Two families, both open source (SIL Open Font License) and
// self-hosted at build time by `next/font` (no request to a font CDN from the visitor's browser).
// To change them: swap the imports below for any other family of `next/font/google`, or use
// `next/font/local` with your own files. The CSS only knows `--font-display` and `--font-body`.

import { Fraunces, Inter } from "next/font/google";

/** Headings. */
export const display = Fraunces({ subsets: ["latin"], display: "swap", variable: "--font-display", weight: ["500", "600"] });
/** Everything else. */
export const body = Inter({ subsets: ["latin"], display: "swap", variable: "--font-body" });

export const fontVariables = `${display.variable} ${body.variable}`;
