/**
 * An ETag as a server compares it in If-Match: without the weak marker and without what
 * compressing web servers add to it (Apache's mod_deflate turns "abc" into "abc-gzip").
 */
export function cleanEtag(etag: string | null | undefined): string | null {
  if (!etag) return null
  return etag.replace(/^W\//, '').replace(/-(?:gzip|br|deflate|zstd)"$/, '"')
}
