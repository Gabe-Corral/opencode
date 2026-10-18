import { expect, test } from "bun:test"
import { permissionPresentation, permissionReviewDiff, permissionReviewSides } from "../../src/util/permission"

test("exports every proposed file without changing the permission decision", () => {
  expect(
    permissionReviewDiff({
      files: [
        { file: "a.txt", patch: "--- a.txt\n+++ a.txt\n+first\n", additions: 1, deletions: 0, status: "modified" },
        { file: "b.txt", patch: "--- b.txt\n+++ b.txt\n+second\n", additions: 1, deletions: 0, status: "added" },
      ],
    }),
  ).toMatchObject({ text: "--- a.txt\n+++ a.txt\n+first\n\n--- b.txt\n+++ b.txt\n+second\n" })
  expect(permissionReviewDiff({ files: [{ patch: "partial" }] })).toBeUndefined()
  expect(permissionReviewDiff()).toBeUndefined()
})

test("reconstructs each side of the proposed hunks for language-aware Neovim review", async () => {
  expect(
    await permissionReviewSides([
      {
        file: "src/main.ts",
        patch: "--- src/main.ts\n+++ src/main.ts\n@@ -1,2 +1,2 @@\n-const a = 1\n+const a = 2\n console.log(a)\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ]),
  ).toEqual([{ file: "src/main.ts", before: "const a = 1\nconsole.log(a)\n", after: "const a = 2\nconsole.log(a)\n" }])
  expect(
    await permissionReviewSides([
      { file: "src/main.ts", patch: "not a patch", additions: 1, deletions: 1, status: "modified" },
    ]),
  ).toEqual([])
})

test("preserves permission roots and self-contained metadata", () => {
  expect(permissionPresentation({ action: "external_directory", resources: ["/*"] }).title).toBe(
    "Access external directory /",
  )
  expect(permissionPresentation({ action: "external_directory", resources: ["C:/*"] }).title).toBe(
    "Access external directory C:/",
  )
  expect(
    permissionPresentation({ action: "webfetch", resources: [], metadata: { url: "https://example.com" } }),
  ).toMatchObject({
    title: "WebFetch https://example.com",
    lines: ["URL: https://example.com"],
  })
  expect(permissionPresentation({ action: "websearch", resources: [], metadata: { query: "releases" } })).toMatchObject(
    {
      title: 'Web Search "releases"',
      lines: ["Query: releases"],
    },
  )
})
