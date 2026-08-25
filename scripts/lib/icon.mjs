// Generate a self-contained `data:` URI icon for a userscript.
//
// Why not a favicon service: https://www.google.com/s2/favicons?domain=<x>
// returns HTTP 404 for domains it has no icon for (example.com is one), and
// Violentmonkey surfaces that as a red "Error fetching resource!" on the
// script card. A remote icon also leaks to a third party which sites you run
// scripts on, and breaks offline. A data URI has none of those problems.

/** Deterministic hue from a slug, so each script keeps a stable colour. */
function hueFor(slug) {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return hash;
}

/** 1–2 uppercase initials: "page-title-tag" -> "PT", "hello" -> "HE". */
function initialsFor(slug) {
  const words = slug.split('-').filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : slug.slice(0, 2);
  return letters.toUpperCase();
}

export function iconFor(slug) {
  const hue = hueFor(slug);
  const initials = initialsFor(slug);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="hsl(${hue} 62% 46%)"/>` +
    `<text x="32" y="33" fill="#fff" font-family="Helvetica,Arial,sans-serif"` +
    ` font-size="27" font-weight="700" text-anchor="middle"` +
    ` dominant-baseline="central">${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
