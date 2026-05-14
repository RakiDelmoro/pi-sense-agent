import { UPLOADS_DIR } from "../config";
import { readdir, stat, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

async function ensureDir(dir: string) {
  try { await stat(dir); } catch { await mkdir(dir, { recursive: true }); }
}

export async function handleFiles(path: string, method: string, req: Request): Promise<Response | null> {
  // POST /api/upload
  if (path === "/api/upload" && method === "POST") {
    await ensureDir(UPLOADS_DIR);
    const formData = await req.clone().formData().catch(() => null);
    if (!formData) return Response.json({ error: "Invalid form data" }, { status: 400 });
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });
    const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    await Bun.write(join(UPLOADS_DIR, name), file);
    return Response.json({ ok: true, name, url: `/api/files/${name}` });
  }

  // GET /api/files
  if (path === "/api/files" && method === "GET") {
    await ensureDir(UPLOADS_DIR);
    try {
      const entries = await readdir(UPLOADS_DIR);
      const files: string[] = [];
      for (const entry of entries) {
        const s = await stat(join(UPLOADS_DIR, entry));
        if (s.isFile()) files.push(entry);
      }
      return Response.json({ files });
    } catch { return Response.json({ files: [] }); }
  }

  // /api/files/:name
  const filesMatch = path.match(/^\/api\/files\/(.+)$/);
  if (filesMatch) {
    const name = filesMatch[1].replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = join(UPLOADS_DIR, name);

    if (method === "GET") {
      const bunFile = Bun.file(filePath);
      if (!(await bunFile.exists())) return new Response("Not Found", { status: 404 });
      return new Response(bunFile);
    }
    if (method === "DELETE") {
      try { await rm(filePath); return Response.json({ ok: true }); }
      catch { return new Response("Not Found", { status: 404 }); }
    }
  }

  return null;
}
