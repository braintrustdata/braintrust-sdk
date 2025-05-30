import logging
import os
import textwrap
import time

from botocore.exceptions import ClientError

from braintrust.logger import app_conn, login

# pylint: disable=no-name-in-module
from ...aws import cloudformation
from ...util import response_raise_for_status

_logger = logging.getLogger("braintrust.install.api")

PARAMS = {
    "OrgName": "org_name",
    "ProvisionedConcurrency": "provisioned_concurrency",
    "EncryptDatabase": "encrypt_database",
    "PostgresAlternativeHost": "postgres_alternative_host",
    "APIHandlerMemorySize": "api_handler_memory_size",
    "WhitelistedOrigins": "whitelisted_origins",
    "PublicSubnet1AZ": "public_subnet_1_az",
    "PrivateSubnet1AZ": "private_subnet_1_az",
    "PrivateSubnet2AZ": "private_subnet_2_az",
    "PrivateSubnet3AZ": "private_subnet_3_az",
    "VPCCIDR": "vpc_cidr",
    "PublicSubnet1CIDR": "public_subnet_1_cidr",
    "PrivateSubnet1CIDR": "private_subnet_1_cidr",
    "PrivateSubnet2CIDR": "private_subnet_2_cidr",
    "PrivateSubnet3CIDR": "private_subnet_3_cidr",
    "ManagedPostgres": "managed_postgres",
    "ManagedClickhouse": "managed_clickhouse",
    "ClickhouseInstanceType": "clickhouse_instance_type",
    "PostgresVersion": "postgres_version",
    "OutboundRateLimitWindowMinutes": "outbound_rate_limit_window_minutes",
    "OutboundRateLimitMaxRequests": "outbound_rate_limit_max_requests",
    "UseGlobalProxy": "use_global_proxy",
    "EnableQuarantine": "enable_quarantine",
    "EnableBrainstore": "enable_brainstore",
    "BrainstoreInstanceKeyPairName": "brainstore_instance_key_pair_name",
    "BrainstoreInstanceType": "brainstore_instance_type",
    "BrainstoreInstanceCount": "brainstore_instance_count",
    "BrainstoreMaxInstanceCount": "brainstore_max_instance_count",
    "BrainstoreVersionOverride": "brainstore_version_override",
    "BrainstoreLicenseKey": "brainstore_license_key",
}

REMOVED_PARAMS = ["ThirdAZIndex"]

DEFAULTS = {
    "DwType": "Postgres",
    "EncryptDatabase": "false",
    "ProvisionedConcurrency": 0,
    "APIHandlerMemorySize": 10240,
}

CAPABILITIES = ["CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND"]

LATEST_TEMPLATE = "https://braintrust-cf.s3.amazonaws.com/braintrust-latest.yaml"


def build_parser(subparsers, parents):
    parser = subparsers.add_parser("api", help="Install the Braintrust function API", parents=parents)

    parser.add_argument("name", help="Name of the CloudFormation stack to create or update")
    parser.add_argument(
        "--create",
        help="Create the stack if it does not exist",
        action="store_true",
        default=False,
    )
    parser.add_argument(
        "--vpc-connect",
        help="Connect to an existing VPC",
        action="store_true",
        default=False,
    )
    parser.add_argument(
        "--template",
        help="A specific CloudFormation template URL to use",
        default=None,
    )
    parser.add_argument(
        "--update-template",
        help="Update the CloudFormation to the latest version of the template",
        action="store_true",
        default=False,
    )

    # OrgName, ProvisionedConcurrency
    parser.add_argument("--org-name", help="The name of your organization", default=None)
    parser.add_argument(
        "--provisioned-concurrency",
        help="The amount of provisioned concurrency",
        default=None,
        type=int,
    )
    parser.add_argument(
        "--api-handler-memory-size",
        help="The amount of memory to allocate to the API handler",
        default=None,
        type=int,
    )
    parser.add_argument(
        "--whitelisted-origins",
        help="Comma-separated list of origins to whitelist",
        default=None,
    )
    parser.add_argument(
        "--public-subnet-1-az",
        help="The availability zone for the public subnet",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-1-az",
        help="The availability zone for private subnet 1",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-2-az",
        help="The availability zone for private subnet 2",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-3-az",
        help="The availability zone for private subnet 3",
        default=None,
    )

    parser.add_argument(
        "--vpc-cidr",
        help="The CIDR for the VPC",
        default=None,
    )
    parser.add_argument(
        "--public-subnet-1-cidr",
        help="The CIDR for the public subnet",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-1-cidr",
        help="The CIDR for private subnet 1",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-2-cidr",
        help="The CIDR for private subnet 2",
        default=None,
    )
    parser.add_argument(
        "--private-subnet-3-cidr",
        help="The CIDR for private subnet 3",
        default=None,
    )

    # PostgresUrl
    parser.add_argument(
        "--managed-postgres",
        help="Spin up an RDS instance to use as the datastore",
        default=None,
        choices=[None, "true", "false"],
    )
    parser.add_argument(
        "--encrypt-database",
        help="Whether to encrypt the database",
        default="false",
        choices=[None, "true", "false"],
    )
    parser.add_argument(
        "--postgres-version",
        help="The version of the postgres instance",
        default=None,
    )
    parser.add_argument(
        "--postgres-alternative-host",
        help="Use an external host for postgres (but the same secrets)",
        default=None,
    )

    # Clickhouse
    parser.add_argument(
        "--managed-clickhouse",
        help="Spin up a Clickhouse Instance for faster analytics",
        default=None,
        choices=[None, "true", "false"],
    )
    parser.add_argument(
        "--clickhouse-instance-type",
        help="The instance type for the Clickhouse instance",
        default=None,
    )

    # ElastiCacheClusterId
    parser.add_argument("--elasticache-cluster-host", help="The ElastiCacheCluster host to use", default=None)
    parser.add_argument(
        "--elasticache-cluster-port", help="The ElastiCacheCluster host to use", default=None, type=int
    )

    # SecurityGroupId, SubnetIds
    parser.add_argument("--security-group-id", help="The security group ID to use", default=None)
    parser.add_argument("--subnet-ids", help="The subnet IDs to use", default=None)

    # Rate limit configuration.
    parser.add_argument(
        "--outbound-rate-limit-window-minutes",
        help="The time frame in minutes over which rate per-user rate limits are accumulated",
        default=None,
        type=int,
    )
    parser.add_argument(
        "--outbound-rate-limit-max-requests",
        help="The maximum number of requests per user allowed in the time frame specified by OutboundRateLimitMaxRequests. Setting to 0 will disable rate limits",
        default=None,
        type=int,
    )

    parser.add_argument(
        "--use-global-proxy",
        help="Use the global cloudflare proxy (https://braintrustproxy.com)",
        default=None,
        choices=[None, "true", "false"],
    )

    parser.add_argument(
        "--enable-quarantine",
        help="Enable the quarantine feature (running typescript and python functions)",
        default=None,
        choices=[None, "true", "false"],
    )

    # Advancd use only
    parser.add_argument(
        "--postgres-url",
        help="[Advanced] The postgres URL to use (if you are connecting to another VPC)",
        default=None,
    )
    parser.add_argument("--clickhouse-pg-url", help="[Advanced] The clickhouse PG URL to use", default=None)
    parser.add_argument("--clickhouse-connect-url", help="[Advanced] The clickhouse connect URL to use", default=None)
    parser.add_argument(
        "--clickhouse-catchup-etl-arn", help="[Advanced] The clickhouse catchup ETL ARN to use", default=None
    )

    # To configure your org
    parser.add_argument(
        "--api-key",
        help="The API key to use to configure your org's API URL and Proxy URL",
        default=os.environ.get("BRAINTRUST_API_KEY", None),
    )

    # Brainstore configuration
    parser.add_argument(
        "--enable-brainstore",
        help="Enable Brainstore object-storage data backend",
        choices=[None, "true", "false"],
        default=None,
    )
    parser.add_argument(
        "--brainstore-license-key",
        help="The license key to use for Brainstore",
        default=None,
    )
    parser.add_argument(
        "--brainstore-instance-key-pair-name",
        help="The EC2 Key Pair to allow SSH access to the Brainstore instance",
        default=None,
    )
    parser.add_argument(
        "--brainstore-instance-type",
        help="EC2 instance type for Brainstore. Must be a Graviton instance type.",
        default=None,
    )
    parser.add_argument(
        "--brainstore-instance-count",
        help="Number of Brainstore instances to run",
        type=int,
        default=None,
    )
    parser.add_argument(
        "--brainstore-max-instance-count",
        help="Max scaling size for Brainstore instances",
        type=int,
        default=None,
    )
    parser.add_argument(
        "--brainstore-version-override",
        help="Lock Brainstore to a specific docker tag",
        default=None,
    )

    parser.set_defaults(func=main)


def main(args):
    template = args.template or LATEST_TEMPLATE

    status = None
    try:
        statuses = cloudformation.describe_stacks(StackName=args.name)["Stacks"]
        if len(statuses) == 1:
            status = statuses[0]
        _logger.debug(status)
    except ClientError as e:
        if "does not exist" not in str(e):
            raise

    vpc_connect = args.vpc_connect
    if status and not vpc_connect:
        vpc_connect = "SecurityGroupId" in set(x["ParameterKey"] for x in status["Parameters"])

    if vpc_connect:
        PARAMS["SecurityGroupId"] = "security_group_id"
        PARAMS["SubnetIds"] = "subnet_ids"
        PARAMS["ElastiCacheClusterHost"] = "elasticache_cluster_host"
        PARAMS["ElastiCacheClusterPort"] = "elasticache_cluster_port"
        PARAMS["PostgresUrl"] = "postgres_url"
        PARAMS["ClickhouseCatchupEtlArn"] = "clickhouse_catchup_etl_arn"
        PARAMS["ClickhouseConnectUrl"] = "clickhouse_connect_url"
        PARAMS["ClickhousePGUrl"] = "clickhouse_pg_url"
        PARAMS["EnableBrainstore"] = "enable_brainstore"
        PARAMS["BrainstoreInstanceKeyPairName"] = "brainstore_instance_key_pair_name"
        PARAMS["BrainstoreLicenseKey"] = "brainstore_license_key"
        PARAMS["BrainstoreInstanceType"] = "brainstore_instance_type"
        PARAMS["BrainstoreInstanceCount"] = "brainstore_instance_count"
        PARAMS["BrainstoreMaxInstanceCount"] = "brainstore_max_instance_count"
        PARAMS["BrainstoreVersionOverride"] = "brainstore_version_override"

        if args.template is None:
            template = "https://braintrust-cf.s3.amazonaws.com/braintrust-latest-vpc.yaml"

    exists = status is not None
    if exists and args.create:
        _logger.error(
            textwrap.dedent(
                f"""\
            Stack with name {args.name} already exists. Either delete it in the AWS console or
            remove the --create flag."""
            )
        )
        exit(1)
    elif not exists and not args.create:
        _logger.error(
            textwrap.dedent(
                f"""\
            Stack with name {args.name} does not exist. Either create it manually by following
            https://www.braintrust.dev/docs/guides/self-hosting/aws or use the --create flag."""
            )
        )
        exit(1)

    if not exists:
        _logger.info(f"Creating stack with name {args.name}")

        params = [
            {
                "ParameterKey": k,
                "ParameterValue": str(v),
            }
            for (k, v) in [
                (param, args.__dict__[arg_name] or DEFAULTS.get(param, None)) for (param, arg_name) in PARAMS.items()
            ]
            if v is not None
        ]
        _logger.info("Using params:")
        for param in params:
            _logger.info(f"  {param['ParameterKey']}: {param['ParameterValue']}")

        _logger.info(f"Typical stack creation takes 10-15 minutes.")

        cloudformation.create_stack(
            StackName=args.name,
            TemplateURL=template,
            Parameters=params,
            Capabilities=CAPABILITIES,
        )

        for _ in range(80):
            status = cloudformation.describe_stacks(StackName=args.name)["Stacks"][0]
            if status["StackStatus"] != "CREATE_IN_PROGRESS":
                exists = True
                break
            _logger.info("Waiting for stack to be created...")
            time.sleep(15)
        else:
            _logger.error(
                textwrap.dedent(
                    """\
                Stack creation timed out. Please check the AWS console to see its status. You can also
                re-run this command without --create to continue the setup process once it's done."""
                )
            )
            exit(1)
        _logger.info(f"Stack with name {args.name} has been created with status: {status['StackStatus']}")
        exit(0)

    _logger.info(f"Stack with name {args.name} has status: {status['StackStatus']}")

    if not ("_COMPLETE" in status["StackStatus"] or "_FAILED" in status["StackStatus"]):
        _logger.info(f"Please re-run this command once the stack has finished creating or updating")
        exit(0)

    # Update params that have changed
    param_updates = {}
    for param, arg_name in PARAMS.items():
        if args.__dict__[arg_name] is not None:
            param_updates[param] = args.__dict__[arg_name]
    if len(param_updates) > 0 or args.update_template:
        template_kwargs = {"TemplateURL": template} if args.update_template else {"UsePreviousTemplate": True}
        _logger.info(f"Updating stack with name {args.name} with template: {template_kwargs}")

        _logger.info("Using params:")
        for param, value in param_updates.items():
            _logger.info(f"  {param}: {value}")

        if args.template:
            new_template = cloudformation.get_template_summary(TemplateURL=template)
            new_params = set(x["ParameterKey"] for x in new_template["Parameters"])
        else:
            new_params = set(x["ParameterKey"] for x in status["Parameters"])

        stack = cloudformation.describe_stacks(StackName=args.name)["Stacks"][0]
        try:
            final_params = [
                {"ParameterKey": param, "ParameterValue": str(update)}
                for (param, update) in param_updates.items()
                if param in new_params and param not in REMOVED_PARAMS
            ] + [
                {"ParameterKey": param["ParameterKey"], "UsePreviousValue": True}
                for param in stack["Parameters"]
                if param["ParameterKey"] not in param_updates
                and param["ParameterKey"] not in REMOVED_PARAMS
                and param["ParameterKey"] in new_params
            ]
            cloudformation.update_stack(
                StackName=args.name,
                Parameters=final_params,
                Capabilities=CAPABILITIES,
                **template_kwargs,
            )
        except ClientError as e:
            if "No updates are to be performed." in str(e):
                _logger.warning("No updates are to be performed.")
            else:
                raise

        for _ in range(120):
            status = cloudformation.describe_stacks(StackName=args.name)["Stacks"][0]
            if status["StackStatus"] != "UPDATE_IN_PROGRESS":
                exists = True
                break
            _logger.info("Waiting for stack to be updated...")
            time.sleep(5)
        else:
            _logger.error(
                textwrap.dedent(
                    """\
                Stack update timed out. Please check the AWS console to see its status. You can also
                re-run this command to try again."""
                )
            )
            exit(1)

        universal_url = [x for x in status["Outputs"] if x["OutputKey"] == "UniversalURL"]
        if universal_url:
            universal_url = universal_url[0]["OutputValue"]
        else:
            universal_url = None

        org_name = [x for x in status["Parameters"] if x["ParameterKey"] == "OrgName"]
        if org_name:
            org_name = org_name[0]["ParameterValue"]
        else:
            org_name = None

        _logger.info(f"Stack with name {args.name} has been updated with status: {status['StackStatus']}")
        _logger.info(f"Universal URL: {universal_url}")

        org_info = []
        if args.api_key:
            login(api_key=args.api_key)
            resp = app_conn().post("api/apikey/login")
            if resp.ok:
                org_info = resp.json()["org_info"]
            else:
                _logger.error(f"Failed to login with API key: {resp.text}")

        if len(org_info) > 0:
            if org_name != "*":
                org_info = [x for x in org_info if x["name"] == org_name]
            if len(org_info) == 0:
                _logger.error(f"Org with name {org_name} does not exist")
                exit(1)
            elif len(org_info) > 1:
                names = ", ".join([x["name"] for x in org_info])
                _logger.error(
                    f"You belong to multiple orgs: {names}. Please use an API key that's scoped to a single org."
                )
                org_info = []

            if len(org_info) == 1:
                org_info = org_info[0]

        if org_info and (universal_url and org_info["api_url"] != universal_url):
            _logger.info(f"Will update org {org_info['name']}'s urls.")
            _logger.info(f"  They are currently set to:")
            _logger.info(f"  API URL: {org_info['api_url']}")
            _logger.info(f"  Proxy URL: {org_info['proxy_url']}")
            _logger.info(f"And will update them to:")

            patch_args = {"id": org_info["id"]}
            if universal_url and org_info["api_url"] != universal_url:
                patch_args["api_url"] = universal_url
                patch_args["is_universal_api"] = True
                _logger.info(f"  API URL: {universal_url}")
                _logger.warn(
                    f"\nNOTE: You can delete the proxy URL from your org settings now. It is no longer needed."
                )

            # Make the actual request
            response_raise_for_status(
                app_conn().post(
                    "api/organization/patch_id",
                    json=patch_args,
                )
            )
