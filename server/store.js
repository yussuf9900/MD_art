import { get, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const isLocal = () =>
  process.env.MDART_LOCAL_DATA === "1" && !process.env.VERCEL;
export function namespace() {
  if (isLocal()) return "local";
  const environment = process.env.VERCEL_ENV;
  if (environment === "production") return "production";
  if (environment === "preview") {
    const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.VERCEL_URL;
    if (!branch)
      throw new HttpError(
        503,
        "Environnement de prévisualisation non identifié.",
      );
    return `preview-${hash(branch).slice(0, 16)}`;
  }
  return "development";
}
const token = () => {
  if (!process.env.BLOB_PRIVATE_READ_WRITE_TOKEN)
    throw new HttpError(503, "Stockage privé Vercel Blob non configuré.");
  return process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
};
function file(key) {
  return path.join(
    process.env.MDART_DATA_DIR || ".local-data",
    namespace(),
    `${key}.json`,
  );
}
export async function read(key) {
  if (isLocal()) {
    try {
      const raw = await readFile(file(key), "utf8");
      return { data: JSON.parse(raw), revision: hash(raw) };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  const result = await get(`mdart/${namespace()}/${key}.json`, {
    access: "private",
    token: token(),
    useCache: false,
  });
  if (!result) return null;
  return {
    data: await new Response(result.stream).json(),
    revision: result.blob.etag,
  };
}
export async function write(key, data, revision) {
  const raw = JSON.stringify(data);
  if (isLocal()) {
    const target = file(key);
    await mkdir(path.dirname(target), { recursive: true });
    let lock;
    try {
      lock = await open(`${target}.lock`, "wx");
    } catch (e) {
      if (e.code === "EEXIST")
        throw new HttpError(
          409,
          "Modification concurrente. Rechargez les données.",
        );
      throw e;
    }
    try {
      const current = await read(key);
      if ((current?.revision || null) !== (revision || null))
        throw new HttpError(
          409,
          "Modification concurrente. Rechargez les données.",
        );
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, raw, { mode: 0o600 });
      await rename(temporary, target);
      return hash(raw);
    } finally {
      await lock.close();
      await unlink(`${target}.lock`);
    }
  }
  try {
    const result = await put(`mdart/${namespace()}/${key}.json`, raw, {
      access: "private",
      token: token(),
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: !!revision,
      ...(revision ? { ifMatch: revision } : {}),
    });
    return result.etag;
  } catch (e) {
    if (
      e.name === "BlobPreconditionFailedError" ||
      e.message?.includes("already exists")
    )
      throw new HttpError(
        409,
        "Modification concurrente. Rechargez les données.",
      );
    throw e;
  }
}
export async function ensure(key, factory) {
  const existing = await read(key);
  if (existing) return existing;
  const data = await factory();
  try {
    return { data, revision: await write(key, data, null) };
  } catch (e) {
    if (e.status === 409) {
      const current = await read(key);
      if (current) return current;
    }
    throw e;
  }
}
export async function mutate(key, factory, fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await ensure(key, factory);
    const result = await fn(current.data);
    try {
      await write(key, current.data, current.revision);
      return result;
    } catch (e) {
      if (e.status !== 409 || attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
    }
  }
}
