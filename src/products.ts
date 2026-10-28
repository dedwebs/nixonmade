import type { Env } from "./env";
import { safeLog } from "./log";

export const PRODUCT_SLUGS = ["field-kit", "ship-kit", "fleet-sheets"] as const;
export type ProductSlug = (typeof PRODUCT_SLUGS)[number];

const LINK_RE = /^plink_[A-Za-z0-9]{8,200}$/;
const PRICE_RE = /^price_[A-Za-z0-9]{8,200}$/;
const KEY_RE = /^[a-z0-9][a-z0-9./_-]{0,200}$/;
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

const MEDIA_TYPES = {
  zip: "application/zip",
  dmg: "application/x-apple-diskimage",
} as const;

export type DownloadMediaType = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES];

export type CatalogProduct = {
  slug: ProductSlug;
  title: string;
  key: string;
  filename: string;
  mediaType: DownloadMediaType;
  contentDisposition: string;
  testLinks: string[];
  testPrices: string[];
  liveLinks: string[];
  livePrices: string[];
};

type Side = "test" | "live";

const PREFIX: Record<ProductSlug, string> = {
  "field-kit": "PRODUCT_FIELD_KIT",
  "ship-kit": "PRODUCT_SHIP_KIT",
  "fleet-sheets": "PRODUCT_FLEET_SHEETS",
};

export function isProductSlug(value: unknown): value is ProductSlug {
  return typeof value === "string" && (PRODUCT_SLUGS as readonly string[]).includes(value);
}

function splitIds(raw: string | undefined, pattern: RegExp): string[] {
  if (!raw) return [];
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!pattern.test(id)) {
      safeLog("product_id_ignored");
      continue;
    }
    ids.push(id);
  }
  return ids;
}

function readTitle(raw: string | undefined, slug: ProductSlug): string {
  if (typeof raw !== "string") return slug;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned.length > 80) return slug;
  return cleaned;
}

function readKey(raw: string | undefined): string | null {
  if (!raw || !KEY_RE.test(raw) || raw.includes("..") || raw.startsWith("/")) return null;
  return raw;
}

function readFilename(raw: string | undefined): string | null {
  if (!raw || !FILENAME_RE.test(raw)) return null;
  return raw;
}

/** Last suffix, lowercased. `Fleet-Sheets.DMG` and `products/fleet-sheets.dmg` are both `dmg`. */
export function fileSuffix(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function mediaTypeForSuffix(suffix: string | null): DownloadMediaType | null {
  if (suffix === "zip" || suffix === "dmg") return MEDIA_TYPES[suffix];
  return null;
}

/** ASCII filename only. The catalog regex rejects quotes, spaces, and newlines. */
export function contentDisposition(filename: string): string {
  return `attachment; filename="${filename}"`;
}

export function loadCatalog(env: Env): CatalogProduct[] {
  const products: CatalogProduct[] = [];
  for (const slug of PRODUCT_SLUGS) {
    const prefix = PREFIX[slug];
    const record = env as unknown as Record<string, string | undefined>;
    const key = readKey(record[`${prefix}_KEY`]);
    const filename = readFilename(record[`${prefix}_FILENAME`]);
    const keyType = mediaTypeForSuffix(key ? fileSuffix(key) : null);
    const fileType = mediaTypeForSuffix(filename ? fileSuffix(filename) : null);
    // The object key and the saved filename must be the same kind of file.
    // A .dmg labeled as a .zip would get the wrong Content-Type.
    if (!key || !filename || !keyType || keyType !== fileType) continue;
    products.push({
      slug,
      title: readTitle(record[`${prefix}_TITLE`], slug),
      key,
      filename,
      mediaType: keyType,
      contentDisposition: contentDisposition(filename),
      testLinks: splitIds(record[`${prefix}_TEST_LINKS`], LINK_RE),
      testPrices: splitIds(record[`${prefix}_TEST_PRICES`], PRICE_RE),
      liveLinks: splitIds(record[`${prefix}_LIVE_LINKS`], LINK_RE),
      livePrices: splitIds(record[`${prefix}_LIVE_PRICES`], PRICE_RE),
    });
  }
  return products;
}

export function findProduct(catalog: CatalogProduct[], slug: ProductSlug): CatalogProduct | null {
  return catalog.find((product) => product.slug === slug) ?? null;
}

export type SessionMatchInput = {
  livemode: boolean;
  paymentLinkId: string | null;
  priceIds: string[];
};

/**
 * A session matches a product when its Payment Link id or a line-item price id
 * is on that product's allowlist for the session's mode. Test ids never match
 * a live session. Zero matches and more than one match both fail closed.
 */
export function matchProduct(
  catalog: CatalogProduct[],
  input: SessionMatchInput,
): CatalogProduct | null {
  const side: Side = input.livemode ? "live" : "test";
  const matches = catalog.filter((product) => {
    const links = side === "live" ? product.liveLinks : product.testLinks;
    const prices = side === "live" ? product.livePrices : product.testPrices;
    const linkHit = input.paymentLinkId ? links.includes(input.paymentLinkId) : false;
    const priceHit = input.priceIds.some((id) => prices.includes(id));
    return linkHit || priceHit;
  });
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}
