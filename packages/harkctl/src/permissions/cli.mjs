import { resolve } from "node:path";
import { checkHarkAuthentication, harkAuthenticationStatus } from "./hark.mjs";
import { readHookInput, runPermissionHook } from "./hook.mjs";
import {
  installationStatus,
  installClaude,
  installCodex,
  installOpenCode,
  uninstallClaude,
  uninstallCodex,
  uninstallOpenCode,
} from "./install.mjs";
import { handleOpenCodeV1Event } from "./opencode-v1.mjs";
import { runOpenCodeV2Bridge } from "./opencode-v2.mjs";

const TARGETS = ["claude", "codex", "opencode"];

function selected(target) {
  if (!target || target === "all") return TARGETS;
  if (!TARGETS.includes(target)) throw new Error(`Unknown agent: ${target}`);
  return [target];
}

function help() {
  return `Usage:
  harkctl permissions setup [claude|codex|opencode|all]
  harkctl permissions uninstall [claude|codex|opencode|all]
  harkctl permissions doctor`;
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const [command, target] = argv;
  const checkAuthentication = options.checkAuthentication ?? checkHarkAuthentication;
  const authenticationStatus =
    options.authenticationStatus ??
    (options.checkAuthentication
      ? async () => ({
          authenticated: await checkAuthentication(),
          scopes: [],
          missingScopes: [],
        })
      : harkAuthenticationStatus);
  const entrypoint = options.entrypoint ?? resolve(process.argv[1]);
  const home = options.home;
  if (!command || command === "help" || command === "--help") {
    return { help: help() };
  }
  if (command === "hook") {
    if (target !== "claude" && target !== "codex")
      throw new Error("Hook agent must be claude or codex");
    return runPermissionHook(target);
  }
  if (command === "daemon") {
    if (target !== "opencode") throw new Error("Daemon agent must be opencode");
    await runOpenCodeV2Bridge();
    return undefined;
  }
  if (command === "opencode-v1-event") {
    await handleOpenCodeV1Event(await readHookInput());
    return { ok: true };
  }
  if (command === "doctor") {
    const auth = await authenticationStatus().catch(() => ({
      authenticated: false,
      scopes: [],
      missingScopes: [],
    }));
    return {
      authenticated: auth.authenticated,
      missingScopes: auth.missingScopes,
      installed: await installationStatus({ ...(home ? { home } : {}) }),
    };
  }
  if (command === "setup") {
    if ((options.install?.platform ?? process.platform) === "win32") {
      throw new Error("Permission bridge setup currently supports macOS and Linux hooks.");
    }
    const auth = await authenticationStatus().catch(() => ({
      authenticated: false,
      missingScopes: [],
    }));
    if (!auth.authenticated) {
      throw new Error("Hark is not authenticated. Run harkctl auth login first.");
    }
    if (auth.missingScopes.length > 0) {
      throw new Error(`Hark login is missing required scopes: ${auth.missingScopes.join(", ")}`);
    }
    const agents = selected(target);
    const platform = options.install?.platform ?? process.platform;
    if (target === "opencode" && platform !== "darwin") {
      throw new Error("OpenCode permission setup currently requires macOS.");
    }
    const installable =
      platform === "darwin" ? agents : agents.filter((agent) => agent !== "opencode");
    const warnings =
      installable.length === agents.length
        ? []
        : [
            "Skipped OpenCode permission setup because its background connector currently requires macOS.",
          ];
    // npx caches can be replaced by any later `npx harkctl` run, silently changing the hooks.
    if (/[\\/]_npx[\\/]/.test(entrypoint)) {
      warnings.push(
        "harkctl is running from an npx cache, which a later npx run can replace. Install it globally (npm install -g harkctl) and run setup again.",
      );
    }
    const results = [];
    for (const agent of installable) {
      const input = { entrypoint, ...(home ? { home } : {}), ...options.install };
      if (agent === "claude") results.push(await installClaude(input));
      if (agent === "codex") results.push(await installCodex(input));
      if (agent === "opencode") results.push(await installOpenCode(input));
    }
    return { installed: results, warnings };
  }
  if (command === "uninstall") {
    const results = [];
    for (const agent of selected(target)) {
      const input = { ...(home ? { home } : {}), ...options.install };
      if (agent === "claude") results.push(await uninstallClaude(input));
      if (agent === "codex") results.push(await uninstallCodex(input));
      if (agent === "opencode") results.push(await uninstallOpenCode(input));
    }
    return { uninstalled: results };
  }
  throw new Error(`Unknown command: ${command}`);
}
