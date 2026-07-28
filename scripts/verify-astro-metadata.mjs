const targetUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const response = await fetch(targetUrl);
if (!response.ok) {
  throw new Error(`Fixture request failed with HTTP ${response.status}`);
}

const html = await response.text();
const articleTags = html.match(/<article\b[^>]*>/gu) ?? [];
if (articleTags.length !== 2) {
  throw new Error(`Expected two rendered articles, found ${articleTags.length}`);
}

function readAttribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}="([^"]+)"`, "u"))?.[1];
}

const sources = articleTags.map((tag) => ({
  file: readAttribute(tag, "data-astro-ai-locator-file"),
  location: readAttribute(tag, "data-astro-ai-locator-loc")
}));

for (const source of sources) {
  if (!source.file?.endsWith("Card.astro")) {
    throw new Error(
      `Article source file is missing or unexpected: ${source.file}`
    );
  }
  if (!source.location || !/^\d+:\d+$/u.test(source.location)) {
    throw new Error(`Article source location is invalid: ${source.location}`);
  }
}

if (
  sources[0]?.file !== sources[1]?.file ||
  sources[0]?.location !== sources[1]?.location
) {
  throw new Error(
    `Repeated articles do not share one source identity: ${JSON.stringify(
      sources
    )}`
  );
}

console.log(
  `Astro metadata gate passed: ${sources[0]?.file}:${sources[0]?.location}`
);
