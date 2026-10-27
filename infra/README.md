# Hark on AWS

Production runs on one `t4g.small` in us-east-1, defined by the CDK stack in
`lib/hark-stack.ts`. There are no inbound ports: a Cloudflare Tunnel connector
on the host carries `hark.fyi` (and the original `hark.ryan.ceo`, which still
serves the API and redirects browser pages) to the app, and operators get a shell
through SSM Session Manager.

```
Cloudflare edge ── tunnel (outbound) ──> cloudflared ──> hark:8787 ──> /data/hark.sqlite
                                                                  └── litestream ──> S3 (backups)
GitHub Actions ── OIDC ──> ECR push, SSM Run Command (HarkDeploy) ──> /opt/hark/deploy.sh <image>
cdk deploy ──> host bundle asset ── HarkUpdateHost (operator) ──> /opt/hark/*
```

| Piece | What it is |
| --- | --- |
| `lib/hark-stack.ts` | VPC (one public subnet, no NAT, flow logs), egress-only security group, the instance, ECR `hark`, backups bucket, `alias/hark-prod` key, the `HarkDeploy`/`HarkUpdateHost` Run Command documents, Session Manager logging, daily EBS snapshots, IAM roles, recover alarm, optional alerts and budget |
| `host/` | The host bundle. The stack uploads it as an asset; first boot and `HarkUpdateHost` install it into `/opt/hark` |
| `host/bootstrap.sh` | Host setup, safe to re-run: Docker, pinned compose plugin, `dnf-automatic`, kernel live patching, log rotation, the IMDS block for containers, the bundle into `/opt/hark` |
| `host/compose.yaml` | `hark`, `cloudflared` and `litestream` containers, all read-only with no capabilities; only `litestream` (host network) can reach the instance role |
| `host/deploy.sh` | Renders `.env` from SSM, pulls, restores a missing DB, starts, waits for healthy, rolls back on failure |
| `host/restore.sh` | Restores the DB from the Litestream replica |
| `scripts/put-env.sh` | Uploads a local env file to SSM as SecureString parameters (key `alias/hark-prod`) |

## Cost

About **$18 per month**, on demand:

| Item | Monthly |
| --- | --- |
| `t4g.small` on demand | ~$12.30 |
| 20 GiB gp3 root volume | ~$1.60 |
| Public IPv4 address | ~$3.60 |
| KMS key `alias/hark-prod` | $1 |
| 7 daily EBS snapshots (incremental) | ~$0.50 |
| S3, ECR, SSM Parameter Store, CloudWatch alarm and logs | cents |

A 1-year no-upfront reserved instance (or Savings Plan) roughly halves the
compute line. NAT gateways, load balancers and Elastic IPs are deliberately absent.

## Configuration

Everything the app reads lives in SSM Parameter Store as SecureString
parameters under `/hark/prod/<NAME>`, encrypted with the stack's KMS key
`alias/hark-prod`. Its key policy lets the account administer it and encrypt
with it, but only the instance role (through SSM) can decrypt, and the instance
role is denied every parameter outside `/hark/prod`. `deploy.sh` renders them to
`/opt/hark/.env` (mode 600) on every deploy. `CLOUDFLARE_TUNNEL_TOKEN` goes only
to `/opt/hark/cloudflared.env` (as `TUNNEL_TOKEN`), so the app never sees it.

Required, or the deploy fails:

| Name | Value |
| --- | --- |
| `APP_URL` | `https://hark.fyi` |
| `BETTER_AUTH_SECRET` | the existing production secret (sessions break if it changes) |
| `CLOUDFLARE_TUNNEL_TOKEN` | the tunnel's connector token |

Required for correct production behaviour:

| Name | Value |
| --- | --- |
| `TRUSTED_CLIENT_IP_HEADER` | `cf-connecting-ip` (safe because the tunnel is the only way in) |
| `APNS_ENVIRONMENT` | `production` |
| `LEGACY_APP_URLS` | `https://hark.ryan.ceo,https://www.hark.fyi` (keep serving the API there; pages redirect to `APP_URL`) |
| `APP_PASS_ISSUER` | `https://hark.ryan.ceo` (web apps pin the pass issuer; never change it) |

Optional, as in the root `compose.yaml`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`APPLE_SIGN_IN_SERVICE_ID`, `APPLE_SIGN_IN_BUNDLE_ID`, `APPLE_SIGN_IN_KEY_ID`,
`APPLE_SIGN_IN_PRIVATE_KEY`, `EXPO_ACCESS_TOKEN`, `APNS_KEY_ID`, `APPLE_TEAM_ID`,
`APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `AUTUMN_API_KEY`, `UNLIMITED_TEAM_OWNER_EMAILS`,
`SERVICE_RATE_LIMIT_PER_MINUTE`, `ACCOUNT_RATE_LIMIT_PER_MINUTE`,
`PRO_SERVICE_RATE_LIMIT_PER_MINUTE`, `PRO_ACCOUNT_RATE_LIMIT_PER_MINUTE`. Unset
ones take the app defaults. `NODE_ENV`, `PORT` and `DATABASE_URL` are set by
`host/compose.yaml`; `put-env.sh` skips them.

Values are single-line: write PEM keys with literal `\n` (the app converts
them), or base64. Values may not contain a single quote.

## One-time setup

1. Sign in to the personal account:
   `export AWS_PROFILE=inbound && aws sso login` (or however the profile
   authenticates), then check `aws sts get-caller-identity`.
2. From the repo root: `pnpm install`, then
   `pnpm --filter @hark/infra exec cdk bootstrap aws://<account-id>/us-east-1`.
3. Deploy the stack: `pnpm --filter @hark/infra run deploy`. Add
   `-- -c alertEmail=you@example.com` for the alarm email and the $30 budget, and
   `-c createGithubOidcProvider=false` if the account already has the GitHub OIDC
   provider. Note the outputs: `InstanceId`, `RepositoryUri`, `BackupsBucketName`,
   `DeployDocumentName`, `GithubDeployRoleArn`. The deploy role trusts only the
   `production` environment of `production-update.yml` on `main`, pinned to the
   numeric repository and owner ids in `cdk.json` (`githubRepositoryId`,
   `githubRepositoryOwnerId`; from `gh api repos/R44VC0RP/hark --jq '.id, .owner.id'`).
   The stack has termination protection and the instance has API termination
   protection; turn both off deliberately before replacing or destroying them.
4. Create the tunnel in Cloudflare Zero Trust (Networks → Tunnels → Create, type
   cloudflared). Copy its token. Do not add the public hostname yet (it would
   collide with the current DNS record); that is the cutover step below.
5. Upload the configuration: `AWS_PROFILE=inbound infra/scripts/put-env.sh <env-file>`,
   where the file holds the production values plus `CLOUDFLARE_TUNNEL_TOKEN=...`,
   `TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip` and `APNS_ENVIRONMENT=production`.
6. In GitHub → Settings → Environments → `production` → Variables, add
   `AWS_DEPLOY_ROLE_ARN` (the `GithubDeployRoleArn` output) and `HARK_INSTANCE_ID`
   (the `InstanceId` output). The old `EXE_DEV_SSH_PRIVATE_KEY` and
   `EXE_DEV_KNOWN_HOSTS` secrets can be deleted after the cutover.
7. Migrate the database (next section), then run the **Production Update**
   workflow. Its last step checks `https://hark.fyi` and `https://hark.ryan.ceo`, so it only passes
   after the cutover.

The instance takes a few minutes after `cdk deploy` to finish `bootstrap.sh`;
check with `sudo cat /var/log/cloud-init-output.log` in a session.

## After a stack update

1. **Parameters moved to the key:** parameters written before `alias/hark-prod`
   existed are still encrypted with `aws/ssm`. Re-upload them once with
   `infra/scripts/put-env.sh <env-file>` (the full production file); check with
   `aws ssm get-parameters-by-path --path /hark/prod --query 'Parameters[].Name'`
   and `aws ssm describe-parameters --parameter-filters Key=Path,Values=/hark/prod --query 'Parameters[].[Name,KeyId]'`.
2. **Host files changed** (anything in `host/`): run `HarkUpdateHost` (below).
   Changing `host/` also changes the instance's user data, which CloudFormation
   applies by stopping and starting the instance (a minute or two of downtime;
   the containers come back on their own, but the new files do not arrive until
   `HarkUpdateHost` runs).
3. Run the **Production Update** workflow so the containers pick up the new
   compose file.

## Migrating from exe.dev

Done on 2026-10-22. The database was copied into the volume before the first
deploy through the (since removed) deploy bucket; see this file's history for
the steps.

## Operations

- **Shell:** `aws ssm start-session --target <InstanceId>`; then
  `cd /opt/hark && sudo docker compose --env-file compose.env ps` (or `logs -f hark`).
- **Deploy:** run the **Production Update** workflow. It builds the arm64 image,
  pushes `:<sha>` and `:latest` (`:<sha>` tags are immutable; a re-run for a pushed
  sha reuses the image) and runs the `HarkDeploy` document, which accepts only
  `<account>.dkr.ecr.us-east-1.amazonaws.com/hark:<40-hex sha>` and runs
  `/opt/hark/deploy.sh <image>`. The workflow prints only the command status; read
  the output with `aws ssm get-command-invocation --command-id <id> --instance-id <InstanceId>`.
- **Update host files:** CI cannot change `/opt/hark`. After a `cdk deploy` that
  changed `host/`, run
  `aws ssm send-command --document-name HarkUpdateHost --document-version '$LATEST' --instance-ids <InstanceId>`.
  It downloads the bundle this stack version uploaded and re-runs `bootstrap.sh`
  (idempotent), which installs it into `/opt/hark`. Then deploy again.
- **Roll back:** if the new image does not become healthy within 60 seconds,
  `deploy.sh` starts the previous image again and fails; the failed container's
  log tail is in `/opt/hark/last-failed-deploy.log`. To go back to an older build
  deliberately, in a session: `sudo /opt/hark/deploy.sh <RepositoryUri>:<older sha>`
  (images older than the last 30 are expired). Database migrations are not rolled
  back, so an older image must tolerate the newer schema.
- **Rotate a secret:** `infra/scripts/put-env.sh <file>` (a file with just the
  changed keys is fine), then re-run the workflow. To remove a key:
  `aws ssm delete-parameter --name /hark/prod/<NAME>`.
- **Backups:** Litestream streams every change to
  `s3://<BackupsBucketName>/hark.sqlite`, with a daily snapshot. It never deletes
  (retention is disabled and the instance role has no `s3:DeleteObject`); the
  bucket expires files after 35 days and noncurrent versions 7 days after that.
  Separately, Data Lifecycle Manager snapshots the instance's volume daily at
  05:00 UTC (instances tagged `hark:snapshot=daily`) and keeps 7. To use one, create
  a volume from the snapshot (EC2 → Snapshots), attach it to the instance or a
  helper instance, and copy `/var/lib/docker/volumes/hark_hark-data/_data/hark.sqlite`.
- **Restore:** in a session, `sudo /opt/hark/restore.sh --force` restores the
  latest state (the current files are moved aside, not deleted). Add
  `-timestamp 2026-10-22T10:00:00Z` for a point in time. The restore is
  integrity-checked (`-integrity-check quick`); if it fails, the moved-aside files
  are put back and hark stays stopped. On a replaced or new instance, just deploy:
  `deploy.sh` restores automatically when the DB is missing, and refuses to start
  an empty database while the replica has data (override in a session with
  `sudo HARK_ALLOW_EMPTY_DB=1 /opt/hark/deploy.sh <image>`).
- **Audit logs:** VPC flow logs and Session Manager transcripts go to CloudWatch
  Logs (the stack's `FlowLogGroup` and `SessionLogGroup`). The session preferences
  document `SSM-SessionManagerRunShell` is region-wide: it applies to every
  Session Manager session in us-east-1.
- **Updates:** `dnf-automatic` applies security updates daily, including kernel
  live patches (Kernel Live Patching is enabled by `bootstrap.sh`); a new kernel
  itself still needs a reboot (`sudo reboot` in a session). Amazon Linux 2023
  pins its repository release, so newer AL2023 releases arrive only with a new
  AMI; to move to one, `dnf upgrade --releasever=latest` in a session, or replace
  the instance (a new instance resolves the latest AMI at launch and restores
  from Litestream on its first deploy).
- **Bump compose, cloudflared or Litestream:** `COMPOSE_VERSION`/`COMPOSE_SHA256`
  in `host/bootstrap.sh`, and the image tag and its linux/arm64 digest in
  `host/compose.yaml` (`docker buildx imagetools inspect <image:tag>`); then
  `cdk deploy`, `HarkUpdateHost`, deploy.

## Checks

`pnpm --filter @hark/infra synth` works offline for the production account (the
AMI id is cached in `cdk.context.json`):
`CDK_DEFAULT_ACCOUNT=375612485665 pnpm --filter @hark/infra synth`.
If `us-east-1a` cannot launch `t4g.small` for this account, pass
`-c availabilityZone=us-east-1b` (this replaces the VPC subnet and the instance).
