import { join } from "node:path";
import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dlm from "aws-cdk-lib/aws-dlm";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Assets from "aws-cdk-lib/aws-s3-assets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

const GITHUB_OWNER = "R44VC0RP";
const GITHUB_REPO_NAME = "hark";
const GITHUB_REPO = `${GITHUB_OWNER}/${GITHUB_REPO_NAME}`;
const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";
/** The only workflow (and branch) allowed to assume the deploy role. */
const GITHUB_DEPLOY_WORKFLOW = `${GITHUB_REPO}/.github/workflows/production-update.yml@refs/heads/main`;
/** ECR repository, fixed so the deploy document can pin its image pattern. */
const REPOSITORY_NAME = "hark";
/** SSM Parameter Store path holding the app's .env (SecureString per key). */
const PARAMETER_PATH = "/hark/prod";
/** Customer managed key for the parameters; put-env.sh encrypts with it. */
const PARAMETER_KEY_ALIAS = "alias/hark-prod";
/** Instance tag the daily EBS snapshot policy selects. */
const BACKUP_TAG = { key: "hark:snapshot", value: "daily" };

export interface HarkStackProps extends cdk.StackProps {
  /** Create the account's GitHub OIDC provider. An account can only have one. */
  readonly createGithubOidcProvider: boolean;
  /** Existing provider ARN, used when createGithubOidcProvider is false. */
  readonly githubOidcProviderArn?: string;
  /** Numeric GitHub id of R44VC0RP/hark; survives renames, unlike the name. */
  readonly githubRepositoryId: string;
  /** Numeric GitHub id of the repository owner. */
  readonly githubRepositoryOwnerId: string;
  /** Enables the SNS alarm topic and the monthly cost budget. */
  readonly alertEmail?: string;
  /** AZ for the single subnet; t4g is not offered in every us-east-1 AZ. */
  readonly availabilityZone: string;
}

export class HarkStack extends cdk.Stack {
  private readonly availabilityZone: string;

  constructor(scope: Construct, id: string, props: HarkStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    this.availabilityZone = props.availabilityZone;

    // One public subnet in one AZ and no NAT: the instance needs only outbound
    // traffic (Cloudflare Tunnel, ECR, S3, SSM), which its public IPv4 provides.
    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.80.0.0/24"),
      availabilityZones: [props.availabilityZone],
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      // Restricting the unused default SG needs a Lambda custom resource; nothing uses it.
      restrictDefaultSecurityGroup: false,
    });
    vpc.addFlowLog("FlowLog", {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, "FlowLogGroup", {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        }),
      ),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // No ingress at all: the only way in is the outbound Cloudflare Tunnel.
    const securityGroup = new ec2.SecurityGroup(this, "InstanceSecurityGroup", {
      vpc,
      description: "Hark host: egress only, ingress arrives through Cloudflare Tunnel",
      allowAllOutbound: true,
    });

    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: REPOSITORY_NAME,
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.AES_256,
      // Deploys pin :<sha>, so a pushed sha can never be swapped; only :latest moves.
      imageTagMutability: ecr.TagMutability.IMMUTABLE_WITH_EXCLUSION,
      imageTagMutabilityExclusionFilters: [
        ecr.ImageTagMutabilityExclusionFilter.wildcard("latest"),
      ],
      lifecycleRules: [{ description: "Keep the last 30 images", maxImageCount: 30 }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const backupsBucket = new s3.Bucket(this, "BackupsBucket", {
      bucketName: `hark-backups-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // Litestream never deletes (retention is disabled in litestream.yml and the
      // instance role has no s3:DeleteObject); the bucket ages files out instead.
      // Daily snapshots keep the newest restore point well inside 35 days.
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(35),
          noncurrentVersionExpiration: cdk.Duration.days(7),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // infra/host, shipped by the stack: first boot and HarkUpdateHost extract it
    // into /opt/hark. CI cannot change what runs as root on the host.
    const hostBundle = new s3Assets.Asset(this, "HostBundle", {
      path: join(__dirname, "../host"),
    });

    const parameterArn = (suffix: string) =>
      cdk.Stack.of(this).formatArn({
        service: "ssm",
        resource: "parameter",
        resourceName: `${PARAMETER_PATH.slice(1)}${suffix}`,
      });

    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Hark host: SSM access, ECR pull, its parameters and its buckets",
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    // AmazonSSMManagedInstanceCore allows reading every parameter in the account;
    // this host may read only its own.
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:GetParameterHistory",
        ],
        notResources: [parameterArn(""), parameterArn("/*")],
      }),
    );

    // Only this host can decrypt the parameters. The account can administer the
    // key and encrypt with it (put-env.sh), but the key policy grants Decrypt to
    // no one else, so IAM policies elsewhere in the account cannot add it.
    new kms.Key(this, "ParameterKey", {
      alias: PARAMETER_KEY_ALIAS,
      description: "Hark production parameters (/hark/prod)",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            sid: "AccountAdministersAndEncrypts",
            principals: [new iam.AccountRootPrincipal()],
            actions: [
              "kms:Create*",
              "kms:Describe*",
              "kms:Enable*",
              "kms:List*",
              "kms:Put*",
              "kms:Update*",
              "kms:Revoke*",
              "kms:Disable*",
              "kms:Get*",
              "kms:Delete*",
              "kms:TagResource",
              "kms:UntagResource",
              "kms:ScheduleKeyDeletion",
              "kms:CancelKeyDeletion",
              "kms:RotateKeyOnDemand",
              "kms:Encrypt",
              "kms:GenerateDataKey*",
            ],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            sid: "HostDecryptsThroughSsm",
            principals: [instanceRole],
            actions: ["kms:Decrypt", "kms:DescribeKey"],
            resources: ["*"],
            conditions: { StringEquals: { "kms:ViaService": `ssm.${this.region}.amazonaws.com` } },
          }),
        ],
      }),
    });
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ],
        resources: [repository.repositoryArn],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParametersByPath", "ssm:GetParameter", "ssm:GetParameters"],
        // GetParametersByPath is authorized against the path itself.
        resources: [parameterArn(""), parameterArn("/*")],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        // Only this bundle, not the whole CDK assets bucket (Asset.grantRead).
        actions: ["s3:GetObject"],
        resources: [
          `arn:${this.partition}:s3:::${hostBundle.s3BucketName}/${hostBundle.s3ObjectKey}`,
        ],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket", "s3:GetBucketLocation"],
        resources: [backupsBucket.bucketArn],
      }),
    );
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [backupsBucket.arnForObjects("*")],
      }),
    );

    // Session Manager transcripts (see SessionPreferences below).
    const sessionLogGroup = new logs.LogGroup(this, "SessionLogGroup", {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    sessionLogGroup.grantWrite(instanceRole);
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        // The agent checks the log group exists before streaming; neither is resource-scoped.
        actions: ["logs:DescribeLogGroups", "logs:DescribeLogStreams"],
        resources: ["*"],
      }),
    );

    // Download the host bundle and run its bootstrap.sh, which installs the
    // runtime and the bundle into /opt/hark. First boot and HarkUpdateHost run
    // the same commands; bootstrap.sh is safe to re-run.
    const hostSetupCommands = [
      "set -euo pipefail",
      `export LITESTREAM_BUCKET=${backupsBucket.bucketName}`,
      `export AWS_REGION=${this.region}`,
      "staging=$(mktemp -d)",
      `aws s3 cp --region ${this.region} --only-show-errors ${hostBundle.s3ObjectUrl} "$staging/host.zip"`,
      'python3 -m zipfile -e "$staging/host.zip" "$staging/host"',
      'bash "$staging/host/bootstrap.sh" "$staging/host"',
      'rm -rf "$staging"',
    ];
    const userData = ec2.UserData.forLinux();
    userData.addCommands(...hostSetupCommands);

    const instance = new ec2.Instance(this, "Instance", {
      instanceName: "hark",
      vpc,
      availabilityZone: props.availabilityZone,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      associatePublicIpAddress: true,
      securityGroup,
      role: instanceRole,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      // Latest AL2023 arm64 at the time of the lookup, cached as a concrete AMI id in
      // cdk.context.json. Without the cache the AMI would re-resolve on every deploy
      // and replace the instance (and its data volume) whenever AWS publishes a new
      // image. Refresh deliberately with `cdk context --reset`.
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
        cachedInContext: true,
      }),
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      httpEndpoint: true,
      httpTokens: ec2.HttpTokens.REQUIRED,
      // 1 hop: containers on a Docker bridge cannot get an IMDSv2 token. Only the
      // Litestream container needs the role, and it runs on the host network.
      httpPutResponseHopLimit: 1,
      detailedMonitoring: false,
      disableApiTermination: true,
      userData,
    });
    cdk.Tags.of(instance).add(BACKUP_TAG.key, BACKUP_TAG.value);

    // Daily crash-consistent snapshots of the instance's volume, a second backup
    // mechanism that does not depend on Litestream or the instance's credentials.
    const snapshotRole = new iam.Role(this, "SnapshotPolicyRole", {
      assumedBy: new iam.ServicePrincipal("dlm.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSDataLifecycleManagerServiceRole",
        ),
      ],
    });
    new dlm.CfnLifecyclePolicy(this, "SnapshotPolicy", {
      description: "Hark host daily EBS snapshots keep 7",
      state: "ENABLED",
      executionRoleArn: snapshotRole.roleArn,
      policyDetails: {
        policyType: "EBS_SNAPSHOT_MANAGEMENT",
        resourceTypes: ["INSTANCE"],
        targetTags: [BACKUP_TAG],
        schedules: [
          {
            name: "daily",
            createRule: { interval: 24, intervalUnit: "HOURS", times: ["05:00"] },
            retainRule: { count: 7 },
            copyTags: true,
          },
        ],
      },
    });

    // Run Command documents. CI may run only HarkDeploy, whose single parameter
    // must be an image of this repository pinned to a commit sha; the command
    // itself is fixed. HarkUpdateHost (operator only) installs the host bundle
    // this stack version shipped.
    const deployDocumentName = "HarkDeploy";
    const imagePattern = `^${this.account}\\.dkr\\.ecr\\.${this.region}\\.amazonaws\\.com/${REPOSITORY_NAME}:[0-9a-f]{40}$`;
    new ssm.CfnDocument(this, "DeployDocument", {
      name: deployDocumentName,
      documentType: "Command",
      updateMethod: "NewVersion",
      content: {
        schemaVersion: "2.2",
        description: "Deploy one Hark image with /opt/hark/deploy.sh",
        parameters: {
          image: {
            type: "String",
            description: "ECR image URI pinned to a commit sha",
            allowedPattern: imagePattern,
          },
        },
        mainSteps: [
          {
            action: "aws:runShellScript",
            name: "deploy",
            inputs: { timeoutSeconds: "900", runCommand: ["/opt/hark/deploy.sh {{ image }}"] },
          },
        ],
      },
    });
    new ssm.CfnDocument(this, "UpdateHostDocument", {
      name: "HarkUpdateHost",
      documentType: "Command",
      updateMethod: "NewVersion",
      content: {
        schemaVersion: "2.2",
        description:
          "Install this stack version's host bundle into /opt/hark (re-runs bootstrap.sh)",
        mainSteps: [
          {
            action: "aws:runShellScript",
            name: "updateHost",
            inputs: { timeoutSeconds: "900", runCommand: hostSetupCommands },
          },
        ],
      },
    });

    // Session Manager preferences for the region: every session's transcript goes
    // to CloudWatch Logs.
    new ssm.CfnDocument(this, "SessionPreferences", {
      name: "SSM-SessionManagerRunShell",
      documentType: "Session",
      updateMethod: "NewVersion",
      content: {
        schemaVersion: "1.0",
        description: "Session Manager preferences: log sessions to CloudWatch Logs",
        sessionType: "Standard_Stream",
        inputs: {
          cloudWatchLogGroupName: sessionLogGroup.logGroupName,
          cloudWatchEncryptionEnabled: false,
          cloudWatchStreamingEnabled: true,
          s3BucketName: "",
          s3KeyPrefix: "",
          s3EncryptionEnabled: false,
          kmsKeyId: "",
          runAsEnabled: false,
          runAsDefaultUser: "",
          idleSessionTimeout: "20",
          shellProfile: { linux: "", windows: "" },
        },
      },
    });

    const githubProvider = props.createGithubOidcProvider
      ? new iam.OidcProviderNative(this, "GithubOidcProvider", {
          url: GITHUB_OIDC_URL,
          clientIds: ["sts.amazonaws.com"],
        })
      : iam.OidcProviderNative.fromOidcProviderArn(
          this,
          "GithubOidcProvider",
          props.githubOidcProviderArn ??
            cdk.Stack.of(this).formatArn({
              service: "iam",
              region: "",
              resource: "oidc-provider",
              resourceName: "token.actions.githubusercontent.com",
            }),
        );

    const deployRole = new iam.Role(this, "GithubDeployRole", {
      roleName: "hark-github-deploy",
      description: "GitHub Actions production deploy for Hark",
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.oidcProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            // The repo uses GitHub's immutable subject format (owner@id/repo@id),
            // so a rename or a re-created repo with the same name cannot match.
            "token.actions.githubusercontent.com:sub": `repo:${GITHUB_OWNER}@${props.githubRepositoryOwnerId}/${GITHUB_REPO_NAME}@${props.githubRepositoryId}:environment:production`,
            "token.actions.githubusercontent.com:job_workflow_ref": GITHUB_DEPLOY_WORKFLOW,
            "token.actions.githubusercontent.com:repository_id": props.githubRepositoryId,
            "token.actions.githubusercontent.com:repository_owner_id":
              props.githubRepositoryOwnerId,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          // Tags are immutable: a re-run for a pushed sha skips the build.
          "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        resources: [repository.repositoryArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:SendCommand"],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: "ec2",
            resource: "instance",
            resourceName: instance.instanceId,
          }),
          cdk.Stack.of(this).formatArn({
            service: "ssm",
            resource: "document",
            resourceName: deployDocumentName,
          }),
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        // None of these support resource-level permissions.
        actions: [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
          "ec2:DescribeInstances",
        ],
        resources: ["*"],
      }),
    );

    // EC2 auto-recovery when the underlying host fails its status check.
    const systemCheckAlarm = new cloudwatch.Alarm(this, "SystemStatusCheckAlarm", {
      alarmDescription: "Hark host failed the EC2 system status check; recovering",
      metric: new cloudwatch.Metric({
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed_System",
        dimensionsMap: { InstanceId: instance.instanceId },
        statistic: "Maximum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.MISSING,
    });
    systemCheckAlarm.addAlarmAction(new cwActions.Ec2Action(cwActions.Ec2InstanceAction.RECOVER));

    if (props.alertEmail) {
      const topic = new sns.Topic(this, "AlertTopic", { displayName: "Hark alerts" });
      topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
      systemCheckAlarm.addAlarmAction(new cwActions.SnsAction(topic));

      // Basic scan-on-push results with any HIGH or CRITICAL finding.
      new events.Rule(this, "ImageScanFindingsRule", {
        description: "Hark image scan found HIGH or CRITICAL vulnerabilities",
        eventPattern: {
          source: ["aws.ecr"],
          detailType: ["ECR Image Scan"],
          detail: {
            "repository-name": [REPOSITORY_NAME],
            "scan-status": ["COMPLETE"],
            $or: [
              { "finding-severity-counts": { CRITICAL: [{ numeric: [">", 0] }] } },
              { "finding-severity-counts": { HIGH: [{ numeric: [">", 0] }] } },
            ],
          },
        },
        targets: [new eventsTargets.SnsTopic(topic)],
      });

      new budgets.CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetName: "hark-monthly",
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: 30, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: "ACTUAL",
              comparisonOperator: "GREATER_THAN",
              threshold: 80,
              thresholdType: "PERCENTAGE",
            },
            subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
          },
        ],
      });
    }

    new cdk.CfnOutput(this, "InstanceId", { value: instance.instanceId });
    new cdk.CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });
    new cdk.CfnOutput(this, "BackupsBucketName", { value: backupsBucket.bucketName });
    new cdk.CfnOutput(this, "DeployDocumentName", { value: deployDocumentName });
    new cdk.CfnOutput(this, "GithubDeployRoleArn", { value: deployRole.roleArn });
  }

  /** The one AZ in use. Overriding this keeps synth free of an AZ lookup. */
  override get availabilityZones(): string[] {
    return [this.availabilityZone];
  }
}
