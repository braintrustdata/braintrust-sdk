import logging

# pylint: disable=no-name-in-module
from ...aws import LazyClient, cloudformation

_logger = logging.getLogger("braintrust.install.logs")


def build_parser(subparsers, parents):
    parser = subparsers.add_parser("run-migrations", help="Run schema migrations", parents=parents)
    parser.add_argument("name", help="Name of the CloudFormation stack")
    parser.set_defaults(func=main)


def main(args):
    resources = cloudformation.describe_stack_resources(StackName=args.name)
    migration_lambda = [r for r in resources["StackResources"] if r["LogicalResourceId"] == "MigrateDatabaseFunction"]
    if not migration_lambda:
        raise ValueError("No MigrateDatabaseFunction found in the stack.")
    migration_lambda = migration_lambda[0]
    arn = migration_lambda["PhysicalResourceId"]
    lambda_ = LazyClient("lambda")
    lambda_.invoke(FunctionName=arn)
