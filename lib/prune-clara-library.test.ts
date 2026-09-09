import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneClaraLibrary, type PrunePrisma } from "./prune-clara-library";

function stub(candidates: string[], failOn: Set<string> = new Set()) {
  const deleted: string[] = [];
  const prisma: PrunePrisma = {
    recipe: {
      async findMany() {
        return candidates.map((id) => ({ id }));
      },
      async delete(args: unknown) {
        const id = (args as { where: { id: string } }).where.id;
        if (failOn.has(id)) throw new Error("FK");
        deleted.push(id);
        return {};
      },
    },
  };
  return { prisma, deleted };
}

test("dry-run (default) deletes nothing but reports candidates", async () => {
  const { prisma, deleted } = stub(["a", "b"]);
  const res = await pruneClaraLibrary(prisma);
  assert.deepEqual(res.candidates, ["a", "b"]);
  assert.equal(res.deleted, 0);
  assert.equal(deleted.length, 0);
});

test("apply deletes every candidate", async () => {
  const { prisma, deleted } = stub(["a", "b"]);
  const res = await pruneClaraLibrary(prisma, { apply: true });
  assert.equal(res.deleted, 2);
  assert.deepEqual(deleted, ["a", "b"]);
});

test("a delete that throws is skipped, batch continues", async () => {
  const { prisma, deleted } = stub(["a", "b", "c"], new Set(["b"]));
  const res = await pruneClaraLibrary(prisma, { apply: true });
  assert.equal(res.deleted, 2);
  assert.deepEqual(deleted, ["a", "c"]);
});
