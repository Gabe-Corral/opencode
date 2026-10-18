import type { CliRenderer } from "@opentui/core"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { Stream } from "node:stream"
import { resolveZedDbPath, resolveZedSelection } from "./editor-zed"

export { normalizePromptContent } from "./prompt/content"

type EditorStdio = "inherit" | "pipe" | "ignore" | number | Stream

export async function openEditor(input: {
  value: string
  renderer: CliRenderer
  cwd?: string
  stdin?: EditorStdio
  review?: { sides: readonly { file: string; before: string; after: string }[] }
}) {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) throw new Error("Set $VISUAL or $EDITOR to open an external editor")
  const file = path.join(os.tmpdir(), `${crypto.randomUUID()}.${input.review ? "diff" : "md"}`)
  const reviewDir = path.join(os.tmpdir(), `opencode-review-${crypto.randomUUID()}`)
  await writeFile(file, input.value)
  input.renderer.suspend()
  input.renderer.currentRenderBuffer.clear()
  try {
    const parts = editor.split(" ")
    const neovim = /^(?:nvim|neovim)(?:\.exe)?$/i.test(path.basename(parts[0]!))
    const sides = input.review?.sides
    if (neovim && sides?.length) {
      await mkdir(reviewDir, { recursive: true })
      const tabs = await Promise.all(
        sides.map(async (side, index) => {
          const directory = path.join(reviewDir, String(index))
          const name = path.basename(side.file)
          const before = path.join(directory, "before", name)
          const after = path.join(directory, "after", name)
          await Promise.all([
            mkdir(path.dirname(before), { recursive: true }),
            mkdir(path.dirname(after), { recursive: true }),
          ])
          await Promise.all([writeFile(before, side.before), writeFile(after, side.after)])
          const quote = (value: string) => value.replaceAll("'", "''")
          return [
            ...(index ? ["tabnew"] : []),
            `execute 'edit' fnameescape('${quote(before)}')`,
            `execute 'vertical diffsplit' fnameescape('${quote(after)}')`,
          ]
        }),
      )
      await writeFile(path.join(reviewDir, "review.vim"), [...tabs.flat(), "tabfirst", ""].join("\n"))
    }
    await new Promise<void>((resolve, reject) => {
      const readonly = input.review && /^(?:n?vim|neovim)(?:\.exe)?$/i.test(path.basename(parts[0]!)) ? ["-R"] : []
      const script = neovim && sides?.length ? ["-S", path.join(reviewDir, "review.vim")] : []
      const child = spawn(parts[0]!, [...parts.slice(1), ...readonly, ...script, ...(script.length ? [] : [file])], {
        cwd: input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd(),
        stdio: [input.stdin ?? "inherit", "inherit", "inherit"],
        shell: process.platform === "win32",
      })
      child.on("error", reject)
      child.on("exit", (code, signal) => {
        if (code === 0) return resolve()
        reject(new Error(`Editor exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
      })
    })
    if (input.review) return
    return (await readFile(file, "utf8")) || undefined
  } finally {
    await rm(file, { force: true }).catch(() => {})
    await rm(reviewDir, { recursive: true, force: true }).catch(() => {})
    input.renderer.currentRenderBuffer.clear()
    input.renderer.resume()
    input.renderer.requestRender()
  }
}

export function discoverEditorConnection(directory: string) {
  const root = path.join(os.homedir(), ".claude", "ide")
  const contains = (parent: string) => {
    const resolved = path.resolve(parent)
    const relative = path.relative(resolved, path.resolve(directory))
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved.length : 0
  }
  try {
    return readdirSync(root)
      .filter((entry) => entry.endsWith(".lock"))
      .flatMap((entry) => {
        const file = path.join(root, entry)
        const port = Number.parseInt(path.basename(file, ".lock"), 10)
        if (!Number.isInteger(port) || port <= 0 || port > 65535) return []
        try {
          const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
          if (value.transport !== undefined && value.transport !== "ws") return []
          const folders = Array.isArray(value.workspaceFolders)
            ? value.workspaceFolders.filter((item): item is string => typeof item === "string")
            : []
          const score = Math.max(0, ...folders.map(contains))
          if (!score) return []
          return [
            {
              url: `ws://127.0.0.1:${port}`,
              authToken: typeof value.authToken === "string" ? value.authToken : undefined,
              source: `lock:${port}`,
              score,
              mtime: statSync(file).mtimeMs,
            },
          ]
        } catch {
          return []
        }
      })
      .sort((left, right) => right.score - left.score || right.mtime - left.mtime)
      .map(({ url, authToken, source }) => ({ url, authToken, source }))[0]
  } catch {
    return undefined
  }
}

export const editorIntegration = {
  connection: discoverEditorConnection,
  selection: (directory: string) => resolveZedSelection(resolveZedDbPath() ?? "", directory),
}
