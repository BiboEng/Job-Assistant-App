import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

/**
 * Where the server's flat files live (interview history, usage counters):
 * DATA_DIR when set — point it at a mounted volume on hosts with an ephemeral
 * filesystem — otherwise server/data/.
 */
const DEFAULT_DIR = fileURLToPath(new URL("../../data", import.meta.url));

export const DATA_DIR = config.dataDir
  ? isAbsolute(config.dataDir)
    ? config.dataDir
    : resolve(process.cwd(), config.dataDir)
  : DEFAULT_DIR;
