import json
import logging
import re
import textwrap
from hashlib import md5

from ... import log_conn, login
from ...aws import iam, redshift_serverless

_logger = logging.getLogger("braintrust.install.redshift")


def build_parser(subparsers, parents):
    parser = subparsers.add_parser(
        "redshift",
        help="Setup Redshift to ingest from Braintrust (Kafka)",
        parents=parents,
    )

    parser.add_argument("name", help="Name of the Redshift cluster (or namespace) to create or update")
    parser.add_argument(
        "--create",
        help="Create the Redshift instance if it does not exist",
        action="store_true",
        default=False,
    )
    parser.add_argument(
        "--serverless",
        help="Use Serverless Redshift",
        action="store_true",
        default=False,
    )
    parser.add_argument("--iam-role", help="IAM Role that can read from Kafka", default=None)
    parser.add_argument(
        "--iam-policy",
        help="Inline IAM policy permitting access to Kafka",
        default="BraintrustMSKReadPolicy",
    )
    parser.add_argument(
        "--msk-cluster-arn",
        help="The ARN of a specific MSK cluster to allow access to. If this flag is unspecified, Redshift can read from any MSK cluster in this AWS account",
        default=None,
        required=True,
    )
    parser.add_argument(
        "--msk-topic-name",
        help="The name of a specific MSK topic to map into Redshift. The policy will allow access to all topics in the cluster, to support future topics",
        default="braintrust",
    )

    parser.add_argument(
        "--org-name",
        help="The name of your organization (optional, only needed if you belong to multiple orgs)",
    )

    parser.set_defaults(func=main)


def main(args):
    if args.create:
        raise NotImplementedError("Creating Redshift clusters is not yet supported")

    if args.msk_topic_name.lower() != args.msk_topic_name:
        raise ValueError("Kafka topic names must be lowercase (b/c of Redshift case sensitivity issues)")

    role_name = args.iam_role or ("bt-redshift-" + md5(args.msk_cluster_arn.encode("utf-8")).hexdigest())
    role = None
    try:
        role = iam.get_role(RoleName=role_name)
    except iam.exceptions.NoSuchEntityException:
        pass

    if role is None:
        _logger.info("Creating IAM Role %s", role_name)
        role = iam.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=json.dumps(
                {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"Service": "redshift.amazonaws.com"},
                            "Action": "sts:AssumeRole",
                        }
                    ],
                }
            ),
            Description="Braintrust Redshift Kafka Reader",
        )

    role_policy = None
    try:
        role_policy = iam.get_role_policy(RoleName=role_name, PolicyName=args.iam_policy)
    except iam.exceptions.NoSuchEntityException:
        pass

    # See definitions here: https://docs.aws.amazon.com/msk/latest/developerguide/iam-access-control.html
    msk_cluster_arn = args.msk_cluster_arn
    account_info, path = msk_cluster_arn.rsplit(":", 1)
    cluster_ident, cluster_name, cluster_uuid = path.split("/")
    if cluster_ident != "cluster":
        raise ValueError(f"Invalid MSK cluster ARN: {msk_cluster_arn}")

    # Allow access to all topics
    msk_topic_arn = f"{account_info}:topic/{cluster_name}/{cluster_uuid}/*"

    if role_policy is None:
        _logger.info(f"Creating inline IAM Policy {args.iam_policy} on {role_name}")

        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "MSKIAMpolicy",
                    "Effect": "Allow",
                    "Action": [
                        "kafka-cluster:ReadData",
                        "kafka-cluster:DescribeTopic",
                        "kafka-cluster:Connect",
                    ],
                    "Resource": [
                        msk_cluster_arn,
                        msk_topic_arn,
                    ],
                },
                {
                    "Sid": "MSKPolicy",
                    "Effect": "Allow",
                    "Action": ["kafka:GetBootstrapBrokers"],
                    "Resource": "*",
                },
            ],
        }
        role_policy = iam.put_role_policy(
            RoleName=role_name,
            PolicyName=args.iam_policy,
            PolicyDocument=json.dumps(policy),
        )

    role_arn = role["Role"]["Arn"]
    if args.serverless:
        namespace = redshift_serverless.get_namespace(namespaceName=args.name)
        if namespace is None:
            raise ValueError(f"Serverless Redshift namespace {args.name} does not exist")

        existing_roles = [re.search(r"iamRoleArn=(.*)(,|\))", d).group(1) for d in namespace["namespace"]["iamRoles"]]
        if role_arn not in existing_roles:
            _logger.info(
                "Adding IAM Role %s to Serverless Redshift namespace %s",
                role_arn,
                args.name,
            )
            redshift_serverless.update_namespace(namespaceName=args.name, iamRoles=existing_roles + [role_arn])
    else:
        raise NotImplementedError("Only Serverless Redshift is currently supported")

    #    if args.serverless:
    #        workgroup = None
    #        next_token = {}
    #        while workgroup is None:
    #            workgroups = _redshift_serverless.list_workgroups(**next_token)
    #            for wg in workgroups["workgroups"]:
    #                if wg["namespaceName"] == args.name:
    #                    workgroup = wg
    #                    break
    #
    #            if "nextToken" in workgroups:
    #                next_token = {"nextToken": workgroups["nextToken"]}
    #            else:
    #                break
    #        print(workgroup)
    #
    #        def get_credentials(database=None):
    #            kwargs = {}
    #            if database:
    #                kwargs["dbName"] = database
    #            return _redshift_serverless.get_credentials(workgroupName=args.name, **kwargs)
    #
    #    else:
    #        raise NotImplementedError("Only Serverless Redshift is currently supported")

    login_kwargs = {"org_name": args.org_name} if args.org_name else {}
    login(**login_kwargs)

    resp = log_conn().get(
        "/dw-test",
        params={"iam_role": role["Role"]["Arn"], "msk_cluster_arn": msk_cluster_arn},
    )
    resp.raise_for_status()
    _logger.info(f"Finished setting up Redshift: {resp.json()}")
