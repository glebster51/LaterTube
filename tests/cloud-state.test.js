const assert = require("node:assert/strict");
const state = require("../cloud-state.js");

function document(videos) {
  return state.createDocument(videos, 1);
}

function video(id, extra = {}) {
  return state.normalizeVideo({
    id,
    title: `Video ${id}`,
    addedAt: 100,
    updatedAt: 100,
    changeId: "initial",
    ...extra
  }, 100);
}

{
  const id = "abc123XYZ_-";
  const initial = { active: document([video(id)]), history: document([]) };
  const archived = state.archive(initial, [id], { now: 200, changeId: "archive-1" });
  assert.equal(archived.active.videos.length, 0);
  assert.equal(archived.history.videos.length, 1);
  assert.equal(archived.history.videos[0].removedAt, 200);

  const restored = state.restore(archived, [id], { now: 300, changeId: "restore-1" });
  assert.equal(restored.active.videos.length, 1);
  assert.equal(restored.history.videos.length, 0);
  assert.equal(restored.active.videos[0].addedAt, 300);
  assert.equal("removedAt" in restored.active.videos[0], false);

  const archivedAgain = state.archive(restored, [id], { now: 400, changeId: "archive-2" });
  assert.equal(archivedAgain.history.videos.length, 1);
  assert.equal(archivedAgain.history.videos[0].removedAt, 400);

  const deleted = state.deleteHistory(archivedAgain, [id], { now: 500, changeId: "delete-1" });
  assert.deepEqual(deleted.deletedIds, [id]);
  assert.equal(deleted.active.videos.length, 0);
  assert.equal(deleted.history.videos.length, 0);
}

{
  const id = "conflict123";
  const active = video(id, { updatedAt: 500, changeId: "active" });
  const history = { ...video(id), removedAt: 600, updatedAt: 600, changeId: "history" };
  const reconciled = state.reconcile(document([active]), document([history]));
  assert.equal(reconciled.active.videos.length, 0);
  assert.equal(reconciled.history.videos[0].id, id);
}

{
  const id = "tieBreak123";
  const active = video(id, { updatedAt: 700, changeId: "aaa" });
  const history = { ...video(id), removedAt: 700, updatedAt: 700, changeId: "bbb" };
  const reconciled = state.reconcile(document([active]), document([history]));
  assert.equal(reconciled.active.videos.length, 0);
  assert.equal(reconciled.history.videos.length, 1);
}

{
  const id = "restoreViaAdd";
  const history = { ...video(id), removedAt: 900, updatedAt: 900, changeId: "old" };
  const result = state.addOrRestore(
    { active: document([]), history: document([history]) },
    [{ id, title: "Fresh title" }],
    { now: 1000, changeId: "import" }
  );
  assert.equal(result.results[0].restored, true);
  assert.equal(result.active.videos[0].title, "Fresh title");
  assert.equal(result.active.videos[0].addedAt, 1000);
  assert.equal(result.history.videos.length, 0);
}

{
  const id = "uniqueHist1";
  const older = { ...video(id), removedAt: 100, updatedAt: 100, changeId: "a" };
  const newer = { ...video(id), removedAt: 200, updatedAt: 200, changeId: "b" };
  const normalized = state.normalizeDocument({ videos: [older, newer, older] }, true, 300);
  assert.equal(normalized.videos.length, 1);
  assert.equal(normalized.videos[0].removedAt, 200);
}

console.log("cloud-state tests passed");
