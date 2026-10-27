import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleOpenCodeV1Event } from "../src/permissions/opencode-v1.mjs";

test("OpenCode V1 permission events approve once through the granular API", async () => {
  const permission = {
    id: "per_v1",
    sessionID: "ses_v1",
    permission: "bash",
    patterns: ["private command"],
    always: ["private *"],
  };
  let reply;
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith("/permission?") && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify([permission]));
    }
    if (request.url?.startsWith("/permission/per_v1/reply?") && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      reply = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      return response.end("true");
    }
    response.statusCode = 404;
    return response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    let sent;
    await handleOpenCodeV1Event(
      {
        serverUrl: `http://127.0.0.1:${address.port}`,
        directory: "/private/project/hark",
        event: { type: "permission.asked", properties: permission },
      },
      async (request) => {
        sent = request;
        return "approved";
      },
    );
    assert.deepEqual(reply, { reply: "once" });
    assert.match(sent.body, /bash permission in hark/);
    assert.equal(sent.imageUrl, "https://hark.fyi/agents/opencode.png");
    assert.doesNotMatch(JSON.stringify(sent), /private command|private\/project/);
  } finally {
    server.close();
  }
});

test("OpenCode V1 falls back to the deprecated reply route", async () => {
  const permission = {
    id: "per_legacy",
    sessionID: "ses_legacy",
    type: "bash",
    pattern: "private command",
  };
  let responseBody;
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith("/permission?") && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify([permission]));
    }
    if (request.url?.startsWith("/permission/per_legacy/reply?")) {
      response.statusCode = 404;
      return response.end();
    }
    if (request.url?.startsWith("/session/ses_legacy/permissions/per_legacy?")) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      responseBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      return response.end("true");
    }
    response.statusCode = 404;
    return response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await handleOpenCodeV1Event(
      {
        serverUrl: `http://127.0.0.1:${address.port}`,
        directory: "/tmp/hark",
        event: { type: "permission.updated", properties: permission },
      },
      async () => "denied",
    );
    assert.deepEqual(responseBody, { response: "reject" });
  } finally {
    server.close();
  }
});
