import { SandboxBashExecutor } from "@deepseek-ai/dsh-bash-sandbox";
import { createGitBashExecutor } from "./gitbash-executor.js";

/**
 * The `@hilariouhiss/dsh-gitbash/executor` row: DSH's sandbox-consuming bash executor
 * running this machine's Git Bash. It registers `ctx.shell` inside the git-bash group's
 * realm, so the host's own executor keeps serving every other row and every preset.
 * @module @hilariouhiss/dsh-gitbash/executor
 */
export default createGitBashExecutor(SandboxBashExecutor);
