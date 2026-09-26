import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../cloud-state.js";

const [, , uid, inputArgument, outputArgument] = process.argv;
if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid || "")) {
  throw new Error("Usage: node tools/create-firebase-import.mjs <firebase-uid> [backup-path] [output-path]");
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(repositoryRoot,
  inputArgument || "ListBackups/LaterTube-backup-2026-07-31.txt");
const outputPath = path.resolve(repositoryRoot,
  outputArgument || "ListBackups/LaterTube-firebase-import.local.json");
const backup = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourceVideos = Array.isArray(backup) ? backup : backup.videos;
if (!Array.isArray(sourceVideos)) throw new Error("Backup does not contain a videos array");

const now = Date.now();
const unique = new Map();
for (const source of sourceVideos) {
  const video = globalThis.LaterTubeCloudState.normalizeVideo(source, now);
  if (video) unique.set(video.id, video);
}
const videos = [...unique.values()];
const createDocument = globalThis.LaterTubeCloudState.createDocument;
const payload = {
  users: {
    [uid]: {
      format: "LaterTube Firebase state",
      schemaVersion: 1,
      updatedAt: now,
      active: createDocument(videos, now),
      history: createDocument([], now)
    }
  }
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Prepared ${videos.length} unique videos for ${uid}: ${outputPath}`);
