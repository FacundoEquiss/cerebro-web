/**
 * A path of this site → its absolute URL. An address that is ALREADY absolute (a photo kept in an
 * external storage bucket, for example) is returned untouched.
 */
export function absoluteUrl(pathOrUrl: string, siteUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith("//")) return pathOrUrl;
  const base = siteUrl.replace(/\/+$/, "");
  if (pathOrUrl === "/" || pathOrUrl === "") return base;
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
