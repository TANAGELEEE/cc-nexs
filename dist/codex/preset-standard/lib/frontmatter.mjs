// Parse Markdown YAML frontmatter without assuming a host-specific line ending.

const FRONTMATTER_RE = /^---(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)---(?:(?:\r\n|\n|\r)|$)/;

export function matchFrontmatter(text) {
  return String(text).match(FRONTMATTER_RE);
}

export function extractFrontmatter(text) {
  return matchFrontmatter(text)?.[1] || '';
}
