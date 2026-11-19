// THE DATA LAYER the pages use. Which adapter answers is decided by DATA_SOURCE (json by
// default). To add another one (a different database, a headless CMS, an ERP…) implement
// `DataAdapter` and register it in `load()`. See docs/adapters.md.

import { cache } from "react";
import { env } from "@/lib/env";
import type { Category, DataAdapter, Product } from "./types";

async function load(): Promise<DataAdapter> {
  switch (env().DATA_SOURCE) {
    case "supabase":
      return (await import("./supabase")).supabaseAdapter;
    case "postgres":
      return (await import("./postgres")).postgresAdapter;
    default:
      return (await import("./json")).jsonAdapter;
  }
}

let adapter: Promise<DataAdapter> | undefined;
export function data(): Promise<DataAdapter> {
  adapter ??= load();
  return adapter;
}

// `cache()` = one read per request, however many components ask.
export const getProducts = cache(async (): Promise<Product[]> => (await data()).listProducts());
export const getCategories = cache(async (): Promise<Category[]> => (await data()).listCategories());

export async function getProduct(slug: string): Promise<Product | undefined> {
  return (await getProducts()).find((p) => p.slug === slug);
}

export async function getCategory(slug: string): Promise<Category | undefined> {
  return (await getCategories()).find((c) => c.slug === slug);
}

