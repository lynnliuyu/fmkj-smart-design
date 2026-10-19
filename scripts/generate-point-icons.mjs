import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  renderPointDeviceSvg,
  supportedIconIds,
} from "../lib/point-device-symbols.mjs";

export async function generatePointIcons(
  outputDirectory = fileURLToPath(
    // Must match iconBasePath in lib/point-icons.ts; the app only serves this directory.
    new URL("../public/assets/point-icons/v1/", import.meta.url),
  ),
) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    supportedIconIds.map((id) =>
      writeFile(
        resolve(outputDirectory, `${id}.svg`),
        renderPointDeviceSvg(id),
      ),
    ),
  );
  return supportedIconIds.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const count = await generatePointIcons();
  process.stdout.write(
    `Generated ${count} device icons from shared CAD geometry.\n`,
  );
}
