import { afterEach, describe, expect, it, vi } from "vitest";

import {
  groupAttachmentsByProject,
  loadContractAttachments,
  type ProjectAttachment,
} from "../lib/contract-attachments.js";

const contract = (
  input: Partial<ProjectAttachment> & { id: string; projectId: string },
): ProjectAttachment => ({
  contentType: "application/pdf",
  createdAt: "2026-06-30T00:00:00.000Z",
  fileName: `${input.id}.pdf`,
  fileUrl: `/files/${input.id}.pdf`,
  kind: "contract",
  size: 1024,
  ...input,
});

describe("contract attachments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads attachments for all projects in a single request and keeps contracts only", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({
        data: [
          contract({ id: "a1", projectId: "project-a" }),
          contract({ id: "b1", kind: "floorplan", projectId: "project-b" }),
        ],
      }),
    } as Response);

    await expect(
      loadContractAttachments(["project-a", "project-b"]),
    ).resolves.toEqual({
      "project-a": [contract({ id: "a1", projectId: "project-a" })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/attachments?projectIds=project-a,project-b",
      {
        cache: "no-store",
      },
    );
  });

  it("groups attachments by project", () => {
    expect(
      groupAttachmentsByProject([
        contract({ id: "a1", projectId: "project-a" }),
        contract({ id: "a2", projectId: "project-a" }),
        contract({ id: "b1", projectId: "project-b" }),
      ]),
    ).toEqual({
      "project-a": [
        contract({ id: "a1", projectId: "project-a" }),
        contract({ id: "a2", projectId: "project-a" }),
      ],
      "project-b": [contract({ id: "b1", projectId: "project-b" })],
    });
  });
});
