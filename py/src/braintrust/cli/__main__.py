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
        default=False,
        action="store_true",
        help="Include additional details, including full stack traces on errors.",
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
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(format="%(asctime)s %(levelname)s [%(name)s]: %(message)s", level=level)

    try:
        ret = args.func(args)
        if ret:
            os._exit(1)
        else:
            os._exit(0)
    except:
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
