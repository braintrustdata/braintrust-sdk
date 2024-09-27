import argparse
import logging
import os
import sys
import textwrap
import traceback

from . import eval, install


def main(args=None):
    """The main routine."""

    # Add the current working directory to sys.path, similar to python's
    # unittesting frameworks.
    sys.path.insert(0, os.getcwd())

    if args is None:
        args = sys.argv[1:]

    parent_parser = argparse.ArgumentParser(add_help=False)
    parent_parser.add_argument(
        "--verbose",
        "-v",
        default=0,
        action="count",
        help="Include additional details, including full stack traces on errors. Pass twice (-vv) for debug logging.",
    )

    parser = argparse.ArgumentParser(
        description=textwrap.dedent(
            """braintrust is a cli tool to work with Braintrust.
    To see help for a specific subcommand, run `braintrust <subcommand> --help`,
    e.g. `braintrust eval --help`"""
        )
    )
    subparsers = parser.add_subparsers(help="sub-command help", dest="subcommand", required=True)

    for module in [eval, install]:
        module.build_parser(subparsers, parent_parser)

    args = parser.parse_args(args=args)
    level = logging.DEBUG if args.verbose >= 2 else logging.INFO
    logging.basicConfig(format="%(asctime)s %(levelname)s [%(name)s]: %(message)s", level=level)

    return args.func(args)


if __name__ == "__main__":
    try:
        ret = main()
        if ret:
            os._exit(1)
    except:
        traceback.print_exc()
        os._exit(1)
