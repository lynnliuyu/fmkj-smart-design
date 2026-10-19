export type ProjectAttachment = {
  id: string;
  projectId: string;
  kind: "contract" | "floorplan" | "quote_pdf" | "project_file";
  fileName: string;
  fileUrl: string;
  contentType: string;
  size: number;
  createdAt: string;
};

export async function loadContractAttachments(projectIds: string[]) {
  if (!projectIds.length) return {};

  try {
    const response = await fetch(
      `/api/attachments?projectIds=${projectIds.map(encodeURIComponent).join(",")}`,
      {
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as { data?: ProjectAttachment[] };
    const contracts = (payload.data ?? []).filter(
      (attachment) => attachment.kind === "contract",
    );

    return groupAttachmentsByProject(contracts);
  } catch {
    return {};
  }
}

export function groupAttachmentsByProject(attachments: ProjectAttachment[]) {
  return attachments.reduce<Record<string, ProjectAttachment[]>>(
    (groups, attachment) => {
      groups[attachment.projectId] = [
        ...(groups[attachment.projectId] ?? []),
        attachment,
      ];
      return groups;
    },
    {},
  );
}
