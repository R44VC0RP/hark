import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execute, parseArgs, parseDuration, run } from "../src/cli.mjs";

test("parses repeatable devices and notify ask options", () => {
  const parsed = parseArgs([
    "notify",
    "ask",
    "Deploy production?",
    "--approval",
    "--device",
    "dev_a",
    "--device=dev_b",
    "--expires-in",
    "10m",
    "--wait",
    "--json",
  ]);
  assert.deepEqual(parsed.positionals, ["notify", "ask", "Deploy production?"]);
  assert.deepEqual(parsed.options.device, ["dev_a", "dev_b"]);
  assert.equal(parsed.options.approval, true);
  assert.equal(parsed.options.wait, true);
  assert.equal(parsed.options.json, true);
  assert.equal(parsed.separatorAt, null);
  assert.equal(parseDuration(parsed.options["expires-in"]), 600);
});

test("a bare -- separator turns everything after it into positionals", () => {
  const parsed = parseArgs(["notify", "--", "ask", "--approval"]);
  assert.deepEqual(parsed.positionals, ["notify", "ask", "--approval"]);
  assert.equal(parsed.separatorAt, 1);
});

test("rejects tokens and unknown options on argv", () => {
  assert.throws(() => parseArgs(["auth", "status", "--token", "secret"]), /Unknown option/);
});

test("removed legacy commands and flags are usage errors", async () => {
  assert.throws(
    () => parseArgs(["notify", "ask", "Deploy?", "--reply"]),
    /Unknown option: --reply/,
  );
  assert.throws(
    () => parseArgs(["notify", "ask", "Deploy?", "--approve", "--deny"]),
    /Unknown option: --approve/,
  );
  assert.throws(() => parseArgs(["notify", "Hi", "--prompt", "P"]), /Unknown option: --prompt/);
  await assert.rejects(
    execute(["ask", "Deploy?", "--approval"], { HARK_TOKEN: "hark_test" }),
    /Unknown command/,
  );
});

test("parses duration suffixes", () => {
  assert.equal(parseDuration("30"), 30);
  assert.equal(parseDuration("2m"), 120);
  assert.equal(parseDuration("1.5h"), 5400);
  assert.equal(parseDuration("90d"), 7_776_000);
  assert.throws(() => parseDuration("tomorrow"), /Invalid duration/);
});

test("exposes permission bridge setup through harkctl", async () => {
  const result = await execute(["permissions", "help"], {});
  assert.equal(result.exitCode, 0);
  assert.equal(result.text, true);
  assert.match(result.body.help, /harkctl permissions setup/);
});

test("creates a webhook service with default appearance", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return Response.json(
      {
        service: {
          id: "svc_test",
          title: "Release bot",
          imageUrl: "https://example.com/bot.png",
          url: null,
        },
        webhookUrl: "https://example.test/hooks/hook_secret",
      },
      { status: 201 },
    );
  };
  try {
    const result = await execute(
      ["services", "create", "--title", "Release bot", "--image", "https://example.com/bot.png"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.webhookUrl, "https://example.test/hooks/hook_secret");
    assert.equal(request.url, "https://example.test/api/agent/services");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(request.init.body), {
      title: "Release bot",
      imageUrl: "https://example.com/bot.png",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth login polls through pending and slow_down without opening a non-TTY browser", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "harkctl-login-"));
  const path = join(directory, "config.json");
  const deviceCode = "d".repeat(43);
  const accessToken = `hark_${"s".repeat(43)}`;
  const calls = [];
  const sleeps = [];
  let opened = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/start")) {
      assert.equal(init.headers.authorization, undefined);
      assert.deepEqual(JSON.parse(init.body), {
        clientName: "CI agent",
        scopes: ["interactions:read"],
        expiresInSeconds: 3600,
      });
      return Response.json(
        {
          deviceCode,
          userCode: "ABCD-EFGH",
          verificationUri: "https://example.test/cli/authorize",
          verificationUriComplete: "https://example.test/cli/authorize?code=ABCD-EFGH",
          expiresIn: 600,
          interval: 5,
        },
        { status: 201 },
      );
    }
    const pollNumber = calls.filter(({ url: value }) => value.endsWith("/token")).length;
    assert.equal(init.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), { deviceCode });
    if (pollNumber === 1) {
      return Response.json({ error: "authorization_pending", interval: 5 }, { status: 400 });
    }
    if (pollNumber === 2) {
      return Response.json({ error: "slow_down", interval: 10 }, { status: 400 });
    }
    return Response.json({
      accessToken,
      token: {
        id: "tok_login",
        name: "CI agent",
        prefix: "hark_ssssssss",
        scopes: ["interactions:read"],
      },
    });
  };
  try {
    const result = await execute(
      [
        "auth",
        "login",
        "--json",
        "--client-name",
        "CI agent",
        "--scope",
        "interactions:read",
        "--expires-in",
        "1h",
      ],
      { HARK_API_URL: "https://example.test", HARK_CONFIG: path },
      {
        openBrowser: () => {
          opened += 1;
        },
        sleep: async (milliseconds) => sleeps.push(milliseconds),
        stderr: () => {},
        stderrIsTTY: false,
      },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(opened, 0);
    assert.deepEqual(sleeps, [5000, 5000, 10000]);
    assert.equal(JSON.stringify(result.body).includes(accessToken), false);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      apiUrl: "https://example.test",
      token: accessToken,
      tokenId: "tok_login",
    });
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("auth login opens only when interactive or explicitly requested", async () => {
  const originalFetch = globalThis.fetch;
  let opened = 0;
  const mockFetch = async (url) => {
    if (String(url).endsWith("/start")) {
      return Response.json(
        {
          deviceCode: "o".repeat(43),
          userCode: "OPEN-2345",
          verificationUri: "https://example.test/cli/authorize",
          verificationUriComplete: "https://example.test/cli/authorize?code=OPEN-2345",
          expiresIn: 600,
          interval: 5,
        },
        { status: 201 },
      );
    }
    return Response.json({
      accessToken: `hark_${"o".repeat(43)}`,
      token: { id: "tok_open", name: "harkctl", prefix: "hark_oooooooo", scopes: [] },
    });
  };
  globalThis.fetch = mockFetch;
  try {
    const overrides = {
      openBrowser: () => {
        opened += 1;
      },
      sleep: async () => {},
      stderr: () => {},
      stderrIsTTY: false,
      writeConfig: async () => {},
    };
    const env = { HARK_API_URL: "https://example.test" };
    await execute(["auth", "login", "--open"], env, overrides);
    assert.equal(opened, 1);
    await execute(["auth", "login", "--no-open"], env, { ...overrides, stderrIsTTY: true });
    assert.equal(opened, 1);
    // An authorization URL on another origin than the API is never opened.
    await execute(["auth", "login", "--open"], {}, overrides);
    assert.equal(opened, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth login maps denied and expired terminal responses", async () => {
  const originalFetch = globalThis.fetch;
  const terminal = async (error) => {
    globalThis.fetch = async (url) =>
      String(url).endsWith("/start")
        ? Response.json(
            {
              deviceCode: "t".repeat(43),
              userCode: "TERM-2345",
              verificationUri: "https://example.test/cli/authorize",
              verificationUriComplete: "https://example.test/cli/authorize?code=TERM-2345",
              expiresIn: 600,
              interval: 5,
            },
            { status: 201 },
          )
        : Response.json({ error }, { status: 400 });
    const stdout = [];
    const stderr = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (value) => stdout.push(value);
    console.error = (value) => stderr.push(value);
    try {
      const code = await run(
        ["auth", "login", "--json"],
        {},
        {
          sleep: async () => {},
          stderrIsTTY: false,
          writeConfig: async () => {},
        },
      );
      assert.equal(stdout.length, 0);
      return code;
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  };
  try {
    assert.equal(await terminal("access_denied"), 5);
    assert.equal(await terminal("expired_token"), 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth login emits one safe JSON object and keeps both secrets out of output", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  const deviceCode = "z".repeat(43);
  const accessToken = `hark_${"z".repeat(43)}`;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/start")
      ? Response.json(
          {
            deviceCode,
            userCode: "SAFE-2345",
            verificationUri: "https://example.test/cli/authorize",
            verificationUriComplete: "https://example.test/cli/authorize?code=SAFE-2345",
            expiresIn: 600,
            interval: 5,
          },
          { status: 201 },
        )
      : Response.json({
          accessToken,
          token: { id: "tok_safe", name: "harkctl", prefix: "hark_zzzzzzzz", scopes: [] },
        });
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  try {
    const exitCode = await run(
      ["auth", "login", "--json"],
      {},
      {
        sleep: async () => {},
        stderrIsTTY: false,
        writeConfig: async () => {},
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(stdout.length, 1);
    assert.equal(stderr.length, 2);
    JSON.parse(stdout[0]);
    assert.equal([...stdout, ...stderr].join("\n").includes(deviceCode), false);
    assert.equal([...stdout, ...stderr].join("\n").includes(accessToken), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("auth logout revokes before removing file credentials", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "harkctl-logout-"));
  const path = join(directory, "config.json");
  const token = `hark_${"r".repeat(43)}`;
  await writeFile(path, JSON.stringify({ token, apiUrl: "https://example.test" }), { mode: 0o600 });
  await chmod(path, 0o600);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/auth/revoke");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    return Response.json({ ok: true });
  };
  try {
    const result = await execute(["auth", "logout"], { HARK_CONFIG: path });
    assert.deepEqual(result.body, {
      authenticated: false,
      revoked: true,
      credentialsRemoved: true,
    });
    await assert.rejects(stat(path), { code: "ENOENT" });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("writes one JSON object to stdout and diagnostics to stderr", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.authorization, "Bearer hark_test");
    return new Response(
      JSON.stringify({ authenticated: true, token: { name: "Test", scopes: [] } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  try {
    assert.equal(await run(["auth", "status"], { HARK_TOKEN: "hark_test" }), 0);
    assert.deepEqual(JSON.parse(stdout[0]), {
      authenticated: true,
      token: { name: "Test", scopes: [] },
    });
    assert.equal(stdout.length, 1);
    assert.equal(stderr.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("notify sends the normalized notification request body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/notifications");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], "deploy-done-1");
    assert.deepEqual(JSON.parse(init.body), {
      body: "Deploy finished",
      title: "Release",
      imageUrl: "https://example.com/bot.png",
      url: "https://example.com/run/1",
      deviceIds: ["dev_a", "dev_b"],
    });
    return Response.json(
      { accepted: 2, notification: { id: "anot_1", title: "Release", body: "Deploy finished" } },
      { status: 201 },
    );
  };
  try {
    const result = await execute(
      [
        "notify",
        "Deploy finished",
        "--title",
        "Release",
        "--image",
        "https://example.com/bot.png",
        "--url",
        "https://example.com/run/1",
        "--device",
        "dev_a",
        "--device",
        "dev_b",
        "--idempotency-key",
        "deploy-done-1",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.notification.id, "anot_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify merges --stdin JSON under explicit flags and exits 7 when nothing is accepted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { body: "Anyone there?" });
    return Response.json(
      { accepted: 0, notification: { id: "anot_none" }, message: "…" },
      {
        status: 201,
      },
    );
  };
  try {
    const result = await execute(["notify", "Anyone there?"], { HARK_TOKEN: "hark_test" });
    assert.equal(result.exitCode, 7);
    assert.equal(result.body.accepted, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify sends project, summary, and body format metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      body: "Deploy finished with a very long report",
      project: "Acme App",
      summary: "Deploy finished",
      bodyFormat: "markdown",
    });
    return Response.json({ accepted: 1, notification: { id: "anot_prj" } }, { status: 201 });
  };
  try {
    const result = await execute(
      [
        "notify",
        "Deploy finished with a very long report",
        "--project",
        "Acme App",
        "--summary",
        "Deploy finished",
        "--markdown",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify --body-format validates values and conflicts with --markdown text", async () => {
  await assert.rejects(
    execute(["notify", "Hi", "--body-format", "html"], { HARK_TOKEN: "hark_test" }),
    /--body-format must be text or markdown/,
  );
  await assert.rejects(
    execute(["notify", "Hi", "--markdown", "--body-format", "text"], {
      HARK_TOKEN: "hark_test",
    }),
    /--markdown conflicts with --body-format text/,
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init.body).bodyFormat, "markdown");
    return Response.json({ accepted: 1, notification: { id: "anot_md" } }, { status: 201 });
  };
  try {
    const result = await execute(["notify", "Hi", "--body-format", "markdown"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify bounds bodies to the server limits before sending", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ accepted: 1, notification: { id: "anot_big" } }, { status: 201 });
  };
  try {
    // 8,001 characters: over the character cap without any request.
    await assert.rejects(
      execute(["notify", "x".repeat(8001)], {
        HARK_TOKEN: "hark_test",
        HARK_API_URL: "https://example.test",
      }),
      /at most 8000 characters/,
    );
    // 6,000 three-byte glyphs: 18,000 bytes of UTF-8, over the byte cap.
    await assert.rejects(
      execute(["notify", "気".repeat(6000)], {
        HARK_TOKEN: "hark_test",
        HARK_API_URL: "https://example.test",
      }),
      /16384 bytes/,
    );
    assert.equal(requests, 0);
    // Exactly at the caps still sends, including via --stdin merge.
    const atLimit = await execute(["notify", "x".repeat(8000)], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(atLimit.exitCode, 0);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask rejects the notify-only project and format flags", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--project", "Acme"], {
      HARK_TOKEN: "hark_test",
    }),
    /apply to notify, not notify ask/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--markdown"], {
      HARK_TOKEN: "hark_test",
    }),
    /apply to notify, not notify ask/,
  );
});

test("notify -- ask sends the literal body ask instead of the subcommand", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ accepted: 1, notification: { id: "anot_ask" } }, { status: 201 });
  };
  try {
    const result = await execute(["notify", "--", "ask"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, [
      {
        url: "https://example.test/api/agent/notifications",
        body: { body: "ask" },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask sends the normalized approval request body with an image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/interactions");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], "deploy-1");
    assert.deepEqual(JSON.parse(init.body), {
      title: "Release",
      prompt: "Deploy production?",
      kind: "approval",
      expiresInSeconds: 600,
      imageUrl: "https://example.com/bot.png",
      deviceIds: ["dev_a"],
    });
    return Response.json({
      accepted: 1,
      interaction: { id: "int_1", status: "pending", actionDigest: "a".repeat(64) },
    });
  };
  try {
    const result = await execute(
      [
        "notify",
        "ask",
        "Deploy production?",
        "--approval",
        "--title",
        "Release",
        "--image",
        "https://example.com/bot.png",
        "--device",
        "dev_a",
        "--expires-in",
        "10m",
        "--idempotency-key",
        "deploy-1",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.interaction.actionDigest, "a".repeat(64));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask sends an interactive Live Activity with cosmetic labels", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      title: "Release",
      prompt: "Send the prepared release email?",
      kind: "approval",
      expiresInSeconds: 900,
      presentation: "live_activity",
      style: "signal",
      primaryLabel: "Send",
      secondaryLabel: "Deny",
    });
    return Response.json({
      accepted: 1,
      liveActivityId: "act_1",
      interaction: { id: "int_live", status: "pending" },
    });
  };
  try {
    const result = await execute(
      [
        "notify",
        "ask",
        "Send the prepared release email?",
        "--approval",
        "--title",
        "Release",
        "--live-activity",
        "--style",
        "signal",
        "--primary-label",
        "Send",
        "--secondary-label",
        "Deny",
      ],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.liveActivityId, "act_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask rejects unsupported Live Activity response shapes", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Write a reply", "--text", "--live-activity"], {
      HARK_TOKEN: "hark_test",
    }),
    /supports --approval or --yes-no/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--primary-label", "Deploy"], {
      HARK_TOKEN: "hark_test",
    }),
    /labels require --live-activity/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--style", "signal"], {
      HARK_TOKEN: "hark_test",
    }),
    /style requires --live-activity/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--live-activity", "--style", "neon"], {
      HARK_TOKEN: "hark_test",
    }),
    /approval, shell, verdict, signal/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--live-activity", "--expires-in", "9h"], {
      HARK_TOKEN: "hark_test",
    }),
    /expire within 8 hours/,
  );
});

test("notify ask --text maps to a reply interaction and defaults the title", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      title: "Hark",
      prompt: "What should the release note say?",
      kind: "reply",
      expiresInSeconds: 900,
    });
    return Response.json({ accepted: 1, interaction: { id: "int_text", status: "pending" } });
  };
  try {
    const result = await execute(["notify", "ask", "What should the release note say?", "--text"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask requires exactly one response type", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Deploy?"], { HARK_TOKEN: "hark_test" }),
    /exactly one response type/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--text"], { HARK_TOKEN: "hark_test" }),
    /exactly one response type/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--yes-no", "--approval"], { HARK_TOKEN: "hark_test" }),
    /exactly one response type/,
  );
});

test("notify ask --yes-no maps to a yes_no interaction and a no answer exits 5", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/agent/interactions")) {
      assert.equal(JSON.parse(init.body).kind, "yes_no");
      return Response.json({ accepted: 1, interaction: { id: "int_yn", status: "pending" } });
    }
    assert.match(String(url), /\/api\/agent\/interactions\/int_yn\/wait\?timeout=/);
    return Response.json({ interaction: { id: "int_yn", status: "no" } });
  };
  try {
    const result = await execute(
      ["notify", "ask", "Keep the current color?", "--yes-no", "--wait", "--timeout", "30s"],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(result.exitCode, 5);
    assert.equal(result.body.interaction.status, "no");

    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/api\/agent\/interactions\/int_yes$/);
      return Response.json({ interaction: { id: "int_yes", status: "yes" } });
    };
    const affirmative = await execute(["interaction", "get", "int_yes"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(affirmative.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask without wait preserves JSON body and exits 7 when no push is accepted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ accepted: 0, interaction: { id: "int_none", status: "pending" } });
  try {
    const result = await execute(["notify", "ask", "Anyone there?", "--text"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 7);
    assert.equal(result.body.accepted, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask with wait exits 7 without making a wait request when no push is accepted", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ accepted: 0, interaction: { id: "int_none_wait", status: "pending" } });
  };
  try {
    const result = await execute(["notify", "ask", "Anyone there?", "--text", "--wait"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 7);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask --poll caps the wait at 20 seconds and maps a pending answer to exit 4", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith("/api/agent/interactions")) {
      return Response.json({ accepted: 1, interaction: { id: "int_poll", status: "pending" } });
    }
    return Response.json({ interaction: { id: "int_poll", status: "pending" }, timedOut: true });
  };
  const ticks = [0, 0, 20_001];
  try {
    const result = await execute(
      ["notify", "ask", "Deploy?", "--approval", "--poll"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
      { now: () => (ticks.length > 1 ? ticks.shift() : ticks[0]) },
    );
    assert.equal(result.exitCode, 4);
    assert.equal(result.body.timedOut, true);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /\/api\/agent\/interactions\/int_poll\/wait\?timeout=20$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask --poll returns an instant terminal answer with wait exit codes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/api/agent/interactions")
      ? Response.json({ accepted: 1, interaction: { id: "int_fast", status: "pending" } })
      : Response.json({ interaction: { id: "int_fast", status: "denied" }, timedOut: false });
  try {
    const result = await execute(["notify", "ask", "Deploy?", "--approval", "--poll"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 5);
    assert.equal(result.body.interaction.status, "denied");
    assert.equal(result.body.timedOut, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask rejects --poll combined with --wait or --timeout", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--poll", "--wait"], {
      HARK_TOKEN: "hark_test",
    }),
    /--poll cannot be combined/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--poll", "--timeout", "5s"], {
      HARK_TOKEN: "hark_test",
    }),
    /--poll cannot be combined/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--timeout", "5s"], {
      HARK_TOKEN: "hark_test",
    }),
    /--timeout requires --wait/,
  );
});

test("wait returns terminal status and timeout zero still returns a defined body", async () => {
  const originalFetch = globalThis.fetch;
  let terminal = true;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/wait\?timeout=/);
    return Response.json({
      interaction: { id: "int_wait", status: terminal ? "approved" : "pending" },
      timedOut: !terminal,
    });
  };
  try {
    const approved = await execute(["interaction", "wait", "int_wait", "--timeout", "1s"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(approved.exitCode, 0);
    assert.equal(approved.body.interaction.status, "approved");

    terminal = false;
    const timedOut = await execute(["interaction", "wait", "int_wait", "--timeout", "0"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(timedOut.exitCode, 4);
    assert.equal(timedOut.body.interaction.status, "pending");
    assert.equal(timedOut.body.timedOut, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity start sends normalized finite progress and routing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/activities");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], "build-start-1");
    assert.deepEqual(JSON.parse(init.body), {
      title: "Build release",
      status: "Compiling",
      key: "release-main",
      replace: true,
      detail: "Web target",
      progress: 0.25,
      symbol: "build",
      privacyMode: "private",
      accentColor: "#FF9F0A",
      style: "ring",
      deviceIds: ["dev_a", "dev_b"],
      expiresInSeconds: 3600,
      staleAfterSeconds: 300,
    });
    return Response.json({ accepted: 2, failed: 0, activity: { id: "act_1", sequence: 0 } });
  };
  try {
    const result = await execute(
      [
        "activity",
        "start",
        "--title",
        "Build release",
        "--status",
        "Compiling",
        "--key",
        "release-main",
        "--replace",
        "--detail",
        "Web target",
        "--progress",
        "0.25",
        "--symbol",
        "build",
        "--privacy",
        "private",
        "--accent-color",
        "#FF9F0A",
        "--style",
        "ring",
        "--device",
        "dev_a",
        "--device",
        "dev_b",
        "--expires-in",
        "1h",
        "--stale-after",
        "5m",
        "--idempotency-key",
        "build-start-1",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.activity.sequence, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity update and end send sequence preconditions", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      accepted: 1,
      failed: 0,
      activity: { id: "act_1", sequence: calls.length },
    });
  };
  try {
    await execute(
      [
        "activity",
        "update",
        "act_1",
        "--status",
        "Testing",
        "--progress",
        "0.7",
        "--if-sequence",
        "2",
        "--accent-color",
        "#64D2FF",
        "--style",
        "hero",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    await execute(
      [
        "activity",
        "end",
        "--key",
        "release-main",
        "--status",
        "Complete",
        "--progress",
        "1",
        "--dismiss-after",
        "30s",
        "--if-sequence",
        "3",
        "--accent-color",
        "#5ED8B7",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      status: "Testing",
      progress: 0.7,
      accentColor: "#64D2FF",
      style: "hero",
      ifSequence: 2,
    });
    assert.equal(calls[0].init.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      status: "Complete",
      progress: 1,
      accentColor: "#5ED8B7",
      dismissAfterSeconds: 30,
      ifSequence: 3,
    });
    assert.match(calls[1].url, /release-main\/end$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity CLI rejects invalid progress and preserves no-delivery exit behavior", async () => {
  await assert.rejects(
    execute(["activity", "start", "--title", "Task", "--status", "Run", "--progress", "2"], {
      HARK_TOKEN: "hark_test",
    }),
    /progress/,
  );
  await assert.rejects(
    execute(
      ["activity", "start", "--title", "Task", "--status", "Run", "--accent-color", "orange"],
      { HARK_TOKEN: "hark_test" },
    ),
    /accent-color/,
  );
  await assert.rejects(
    execute(["activity", "start", "--title", "Task", "--status", "Run", "--style", "neon"], {
      HARK_TOKEN: "hark_test",
    }),
    /--style must be one of: standard, ring, hero, terminal, steps/,
  );
  await assert.rejects(
    execute(["activity", "update", "act_1", "--style", "neon"], { HARK_TOKEN: "hark_test" }),
    /--style must be one of/,
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ accepted: 0, failed: 1, activity: { id: "act_none", sequence: 0 } });
  try {
    const result = await execute(["activity", "start", "--title", "Task", "--status", "Run"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects group-readable config files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harkctl-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({ token: "hark_test" }));
  await chmod(path, 0o640);
  try {
    await assert.rejects(execute(["auth", "status"], { HARK_CONFIG: path }), /mode 0600/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const AGENT_ENV = { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" };

/** Replaces fetch for one test, recording each request and answering from `respond`. */
async function withMockServer(respond, callback) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = {
      path: String(url).replace("https://example.test", ""),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return respond(request);
  };
  try {
    await callback(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("account commands call the matching agent routes", async () => {
  const cases = [
    [["services", "get", "svc_1"], "GET", "/api/agent/services/svc_1"],
    [["services", "rotate", "svc_1"], "POST", "/api/agent/services/svc_1/rotate"],
    [["services", "remove", "svc_1"], "DELETE", "/api/agent/services/svc_1"],
    [["devices", "remove", "dev_1"], "DELETE", "/api/agent/devices/dev_1"],
    [["inbox", "projects"], "GET", "/api/agent/inbox/projects"],
    [
      ["inbox", "list", "--project", "unfiled", "--unread", "--limit", "5", "--cursor", "abc"],
      "GET",
      "/api/agent/inbox/notifications?project=unfiled&limit=5&unread=1&cursor=abc",
    ],
    [["inbox", "get", "event:evt_1"], "GET", "/api/agent/inbox/notifications/event%3Aevt_1"],
    [
      ["inbox", "unread", "event:evt_1"],
      "POST",
      "/api/agent/inbox/notifications/event%3Aevt_1/unread",
    ],
    [["interaction", "list"], "GET", "/api/agent/interactions"],
    [
      ["activity", "feed", "--filter", "response", "--page", "2"],
      "GET",
      "/api/agent/activity-feed?filter=response&page=2",
    ],
    [["billing"], "GET", "/api/agent/billing"],
    [["tokens", "list"], "GET", "/api/agent/tokens"],
    [["tokens", "revoke", "tok_1"], "DELETE", "/api/agent/tokens/tok_1"],
    [["notify", "withdraw", "anot_1"], "POST", "/api/agent/notifications/anot_1/withdraw"],
  ];
  for (const [argv, method, path] of cases) {
    await withMockServer(
      () => Response.json({ ok: true }),
      async (requests) => {
        const result = await execute(argv, AGENT_ENV);
        assert.equal(result.exitCode, 0, argv.join(" "));
        assert.deepEqual(result.body, { ok: true });
        assert.deepEqual(
          requests.map(({ method: m, path: p }) => `${m} ${p}`),
          [`${method} ${path}`],
        );
      },
    );
  }
});

test("services update sends only the provided fields", async () => {
  await withMockServer(
    () => Response.json({ service: { id: "svc_1", title: "Bot" } }),
    async (requests) => {
      const result = await execute(
        ["services", "update", "svc_1", "--title", "Bot", "--url", "https://example.com/x"],
        AGENT_ENV,
      );
      assert.equal(result.exitCode, 0);
      assert.deepEqual(requests, [
        {
          path: "/api/agent/services/svc_1",
          method: "PATCH",
          body: { title: "Bot", url: "https://example.com/x" },
        },
      ]);
    },
  );
  await assert.rejects(execute(["services", "update", "svc_1"], AGENT_ENV), /requires --title/);
  await assert.rejects(execute(["services", "rotate"], AGENT_ENV), /requires an ID/);
});

test("inbox read-all submits the read-through token from a fresh list", async () => {
  await withMockServer(
    ({ path }) =>
      path.startsWith("/api/agent/inbox/notifications?")
        ? Response.json({ items: [], nextCursor: null, readThroughToken: "rt-token" })
        : Response.json({ ok: true, updated: 3 }),
    async (requests) => {
      const result = await execute(["inbox", "read-all", "--project", "prj_1"], AGENT_ENV);
      assert.deepEqual(result.body, { ok: true, updated: 3 });
      assert.deepEqual(requests, [
        {
          path: "/api/agent/inbox/notifications?project=prj_1&limit=1",
          method: "GET",
          body: undefined,
        },
        {
          path: "/api/agent/inbox/notifications/read-all",
          method: "POST",
          body: { readThrough: "rt-token", project: "prj_1" },
        },
      ]);
    },
  );
});

test("notify withdraw is a subcommand unless it follows --", async () => {
  await assert.rejects(
    execute(["notify", "withdraw", "the", "deploy"], AGENT_ENV),
    /exactly one notification ID/,
  );
  await withMockServer(
    () => Response.json({ notification: { id: "anot_2" }, accepted: 1 }, { status: 201 }),
    async (requests) => {
      const result = await execute(["notify", "--", "withdraw"], AGENT_ENV);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(requests, [
        { path: "/api/agent/notifications", method: "POST", body: { body: "withdraw" } },
      ]);
    },
  );
});

test("apps update sends metadata only and prints a readable line", async () => {
  const app = {
    id: "app_1",
    name: "Ops",
    url: "https://new.example.com/",
    consentedAt: null,
  };
  await withMockServer(
    () => Response.json({ app }),
    async (requests) => {
      const result = await execute(
        [
          "apps",
          "update",
          "app_1",
          "--url",
          "https://new.example.com/",
          "--no-icon",
          "--no-project",
        ],
        AGENT_ENV,
      );
      assert.equal(
        result.output,
        "app_1  Ops  https://new.example.com/ (approve sign-in on your phone)",
      );
      assert.deepEqual(requests[0], {
        path: "/api/agent/apps/app_1",
        method: "PATCH",
        body: { url: "https://new.example.com/", iconUrl: null, project: null },
      });
      const revoked = await execute(["apps", "revoke", "app_1", "--json"], AGENT_ENV);
      assert.deepEqual(revoked.body, { app });
      assert.equal(revoked.output, undefined);
      assert.equal(requests[1].path, "/api/agent/apps/app_1/revoke");
    },
  );
  await assert.rejects(
    execute(
      ["apps", "update", "app_1", "--icon", "https://example.com/i.png", "--no-icon"],
      AGENT_ENV,
    ),
    /cannot be used together/,
  );
  await assert.rejects(execute(["apps", "update", "app_1"], AGENT_ENV), /requires --name/);
});

test("a missing scope names the scopes to grant and exits 3", async () => {
  await withMockServer(
    () =>
      Response.json({ error: "Insufficient scope", required: ["tokens:manage"] }, { status: 403 }),
    async () => {
      await assert.rejects(execute(["tokens", "list"], AGENT_ENV), /grant tokens:manage/);
      const originalError = console.error;
      console.error = () => {};
      try {
        assert.equal(await run(["tokens", "list"], AGENT_ENV), 3);
      } finally {
        console.error = originalError;
      }
    },
  );
});

test("default login scopes include the account scopes but not tokens:manage", async () => {
  await withMockServer(
    () => Response.json({ error: "stop here" }, { status: 400 }),
    async (requests) => {
      await assert.rejects(
        execute(["auth", "login", "--no-open"], { HARK_API_URL: "https://example.test" }),
        /stop here/,
      );
      const { scopes } = requests[0].body;
      for (const scope of [
        "devices:write",
        "inbox:read",
        "inbox:write",
        "billing:read",
        "teams:read",
        "teams:write",
        "oncall:read",
        "oncall:write",
      ]) {
        assert.ok(scopes.includes(scope), scope);
      }
      assert.equal(scopes.includes("tokens:manage"), false);
    },
  );
});

test("team and on-call commands call the matching agent routes", async () => {
  const cases = [
    [["teams", "list"], "GET", "/api/agent/teams", undefined],
    [["teams", "create", "Acme", "Ops"], "POST", "/api/agent/teams", { name: "Acme Ops" }],
    [["teams", "rename", "team_1", "New"], "PATCH", "/api/agent/teams/team_1", { name: "New" }],
    [["teams", "delete", "team_1"], "DELETE", "/api/agent/teams/team_1", undefined],
    [
      ["teams", "role", "team_1", "user_2", "admin"],
      "PATCH",
      "/api/agent/teams/team_1/members/user_2",
      { role: "admin" },
    ],
    [
      ["teams", "remove-member", "team_1", "user_2"],
      "DELETE",
      "/api/agent/teams/team_1/members/user_2",
      undefined,
    ],
    [
      ["teams", "invite", "team_1", "--email", "a@example.com", "--role", "admin"],
      "POST",
      "/api/agent/teams/team_1/invites",
      { email: "a@example.com", role: "admin" },
    ],
    [["teams", "invites", "team_1"], "GET", "/api/agent/teams/team_1/invites", undefined],
    [
      ["teams", "revoke-invite", "team_1", "tinv_1"],
      "DELETE",
      "/api/agent/teams/team_1/invites/tinv_1",
      undefined,
    ],
    [["oncall", "list", "--team", "team_1"], "GET", "/api/agent/teams/team_1/oncall", undefined],
    [["oncall", "get", "ocg_1"], "GET", "/api/agent/oncall/ocg_1", undefined],
    [
      ["oncall", "override", "ocg_1", "--user", "u", "--starts-at", "s", "--ends-at", "e"],
      "POST",
      "/api/agent/oncall/ocg_1/overrides",
      { userId: "u", startsAt: "s", endsAt: "e" },
    ],
    [
      ["oncall", "remove-override", "ocg_1", "ovr_1"],
      "DELETE",
      "/api/agent/oncall/ocg_1/overrides/ovr_1",
      undefined,
    ],
    [
      ["pages", "list", "--team", "team_1", "--all"],
      "GET",
      "/api/agent/teams/team_1/pages?status=all",
      undefined,
    ],
    [["pages", "get", "page_1"], "GET", "/api/agent/pages/page_1", undefined],
    [
      ["pages", "resolve", "page_1", "--note", "fixed"],
      "POST",
      "/api/agent/pages/page_1/resolve",
      { note: "fixed" },
    ],
  ];
  for (const [argv, method, path, body] of cases) {
    await withMockServer(
      () => Response.json({ ok: true }),
      async (requests) => {
        const result = await execute(argv, AGENT_ENV);
        assert.equal(result.exitCode, 0, argv.join(" "));
        assert.deepEqual(requests, [{ path, method, body }], argv.join(" "));
      },
    );
  }
  await assert.rejects(
    execute(["teams", "role", "team_1", "u", "boss"], AGENT_ENV),
    /owner\|admin/,
  );
  await assert.rejects(execute(["pages", "list"], AGENT_ENV), /requires --team/);
});

test("page raises an on-call page and exits 7 when nobody was reached", async () => {
  await withMockServer(
    () =>
      Response.json({ page: { id: "page_1" }, deduplicated: false, accepted: 0 }, { status: 201 }),
    async (requests) => {
      const result = await execute(
        ["page", "ocg_1", "API", "down", "--body", "5xx", "--dedup-key", "api"],
        AGENT_ENV,
      );
      assert.equal(result.exitCode, 7);
      assert.deepEqual(requests, [
        {
          path: "/api/agent/oncall/ocg_1/pages",
          method: "POST",
          body: { title: "API down", body: "5xx", dedupKey: "api" },
        },
      ]);
    },
  );
  await withMockServer(
    () => Response.json({ page: { id: "page_1" }, deduplicated: true, accepted: 0 }),
    async (requests) => {
      const result = await execute(["notify", "Disk full", "--oncall", "ocg_1"], AGENT_ENV);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(requests[0].body, { body: "Disk full", oncall: "ocg_1" });
    },
  );
  await assert.rejects(
    execute(["notify", "x", "--oncall", "ocg_1", "--device", "dev_1"], AGENT_ENV),
    /cannot be combined/,
  );
});

test("apps share moves an app into a team or back", async () => {
  await withMockServer(
    ({ body }) =>
      Response.json({
        app: {
          id: "app_1",
          name: "Ops",
          url: "https://ops.example.com/",
          team: body.teamId ? { id: body.teamId, name: "Acme" } : null,
        },
      }),
    async (requests) => {
      const shared = await execute(["apps", "share", "app_1", "--team", "team_1"], AGENT_ENV);
      assert.equal(shared.output, "app_1  Ops  https://ops.example.com/ (shared with Acme)");
      const back = await execute(
        ["apps", "share", "app_1", "--personal", "--no-notify"],
        AGENT_ENV,
      );
      assert.equal(back.output, "app_1  Ops  https://ops.example.com/ (personal)");
      assert.deepEqual(
        requests.map((request) => request.body),
        [{ teamId: "team_1" }, { teamId: null, notify: false }],
      );
    },
  );
  await assert.rejects(execute(["apps", "share", "app_1"], AGENT_ENV), /exactly one of/);
});

test("oncall update keeps unchanged rotation fields, including the original start", async () => {
  const group = {
    rotation: {
      members: [{ userId: "u1" }, { userId: "u2" }],
      period: "weekly",
      handoffAt: "10:00",
      timezone: "Europe/Berlin",
      startsAt: "2026-01-05T09:00:00.000Z",
    },
  };
  await withMockServer(
    () => Response.json({ group }),
    async (requests) => {
      await execute(["oncall", "update", "ocg_1", "--members", "u2,u1"], AGENT_ENV);
      assert.deepEqual(requests[1], {
        path: "/api/agent/oncall/ocg_1",
        method: "PATCH",
        body: {
          rotation: {
            memberIds: ["u2", "u1"],
            period: "weekly",
            handoffAt: "10:00",
            timezone: "Europe/Berlin",
            startsAt: "2026-01-05T09:00:00.000Z",
          },
        },
      });
    },
  );
});

test("a stored token is never sent to a different HARK_API_URL", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "harkctl-override-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({ token: "hark_test", apiUrl: "https://example.test" }), {
    mode: 0o600,
  });
  await chmod(path, 0o600);
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ authenticated: true });
  };
  try {
    const originalError = console.error;
    console.error = () => {};
    try {
      const code = await run(["auth", "status"], {
        HARK_CONFIG: path,
        HARK_API_URL: "http://127.0.0.1:8798",
      });
      assert.equal(code, 3);
    } finally {
      console.error = originalError;
    }
    assert.equal(requests, 0);
    // The stored origin itself (trailing slash aside) is still accepted.
    await execute(["auth", "status"], { HARK_CONFIG: path, HARK_API_URL: "https://example.test/" });
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("API URLs must be https unless they are loopback", async () => {
  await assert.rejects(
    execute(["auth", "status"], { HARK_TOKEN: "hark_test", HARK_API_URL: "http://evil.example" }),
    /must use https/,
  );
  await assert.rejects(
    execute(["auth", "login", "--no-open"], { HARK_API_URL: "http://evil.example" }),
    /must use https/,
  );
});

test("auth login revokes a minted token when the success response is malformed", async () => {
  const originalFetch = globalThis.fetch;
  const accessToken = `hark_${"m".repeat(43)}`;
  const revoked = [];
  let written = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/start")) {
      return Response.json(
        {
          deviceCode: "m".repeat(43),
          userCode: "MALF-2345",
          verificationUri: "https://example.test/cli/authorize",
          verificationUriComplete: "https://example.test/cli/authorize?code=MALF-2345",
          expiresIn: 600,
          interval: 5,
        },
        { status: 201 },
      );
    }
    if (String(url).endsWith("/revoke")) {
      revoked.push(init.headers.authorization);
      return Response.json({ ok: true });
    }
    return Response.json({ accessToken });
  };
  try {
    await assert.rejects(
      execute(
        ["auth", "login", "--no-open"],
        { HARK_API_URL: "https://example.test" },
        {
          sleep: async () => {},
          stderr: () => {},
          writeConfig: async () => {
            written += 1;
          },
        },
      ),
      /Malformed authorization response/,
    );
    assert.equal(written, 0);
    assert.deepEqual(revoked, [`Bearer ${accessToken}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("--stdin accepts only the command's own fields and https urls", async () => {
  const { spawnSync } = await import("node:child_process");
  const bin = join(import.meta.dirname, "..", "bin", "harkctl.mjs");
  const runWithStdin = (args, input) =>
    spawnSync(process.execPath, [bin, ...args], {
      input: JSON.stringify(input),
      env: { PATH: process.env.PATH, HARK_TOKEN: "hark_test", HARK_API_URL: "http://127.0.0.1:9" },
      encoding: "utf8",
    });
  const routed = runWithStdin(["notify", "--stdin"], { body: "Hi", oncall: "ocg_12345678" });
  assert.equal(routed.status, 2);
  assert.match(routed.stderr, /does not accept: oncall/);
  const asked = runWithStdin(["notify", "ask", "--approval", "--stdin"], {
    prompt: "Deploy?",
    deviceIds: ["dev_1"],
  });
  assert.equal(asked.status, 2);
  assert.match(asked.stderr, /does not accept: deviceIds/);
  const scheme = runWithStdin(["notify", "--stdin"], { body: "Hi", url: "shortcuts://run" });
  assert.equal(scheme.status, 2);
  assert.match(scheme.stderr, /--allow-custom-scheme/);
  // With the opt-in, validation passes and the (unreachable) request is attempted.
  const allowed = runWithStdin(["notify", "--stdin", "--allow-custom-scheme"], {
    body: "Hi",
    url: "shortcuts://run",
  });
  assert.equal(allowed.status, 6);
});
