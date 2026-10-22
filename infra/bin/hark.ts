#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { HarkStack } from "../lib/hark-stack";

const app = new cdk.App();

const flag = app.node.tryGetContext("createGithubOidcProvider");
const alertEmail = app.node.tryGetContext("alertEmail");

// Numeric GitHub ids pinned in the deploy role's trust policy (cdk.json; override with -c).
function requiredContext(key: string): string {
  const value = app.node.tryGetContext(key);
  if (value === undefined || value === null || String(value) === "") {
    throw new Error(`Missing context ${key} (set it in cdk.json or pass -c ${key}=...)`);
  }
  return String(value);
}

new HarkStack(app, "Hark", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
  // CLI context values arrive as strings (`-c createGithubOidcProvider=false`).
  createGithubOidcProvider: flag === undefined ? true : flag === true || flag === "true",
  githubOidcProviderArn: app.node.tryGetContext("githubOidcProviderArn"),
  githubRepositoryId: requiredContext("githubRepositoryId"),
  githubRepositoryOwnerId: requiredContext("githubRepositoryOwnerId"),
  availabilityZone: app.node.tryGetContext("availabilityZone") ?? "us-east-1a",
  alertEmail: typeof alertEmail === "string" && alertEmail !== "" ? alertEmail : undefined,
});
