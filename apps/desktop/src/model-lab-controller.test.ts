import { describe, expect, it } from "vitest";
import { ModelLabController } from "./model-lab-controller";
describe("ModelLabController", () => {
  it("rejects concurrent runs and discards a run invalidated by reset", async () => {
    const controller = new ModelLabController();
    let finish!: () => void;
    const pending = controller.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    expect(await controller.run(async () => undefined)).toBe("duplicate");
    controller.reset();
    finish();
    expect(await pending).toBe("discarded");
  });
});
