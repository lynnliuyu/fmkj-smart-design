import { exportCadReview } from "../export-cad-review.mjs";

// A separate process keeps CAD parsing/rendering off the HTTP event loop.
try {
  const options = JSON.parse(process.argv[2]);
  await exportCadReview(options, {
    progress: message => process.send?.({ progress: String(message).slice(0, 500) }),
  });
  process.disconnect?.();
} catch (error) {
  if (["CAD_RENDER_BUDGET", "CAD_SPACE_NOT_FOUND"].includes(error.code)) process.send?.({ errorCode: error.code, publicMessage: error.message });
  console.error(error.message);
  process.exitCode = 1;
  process.disconnect?.();
}
