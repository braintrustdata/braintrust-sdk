import argparse
import logging
import sys
import textwrap

_module_not_found_error = None
try:
    from . import eval, install
except ModuleNotFoundError as e:
    _module_not_found_error = e

if _module_not_found_error is not None:
    raise ModuleNotFoundError(
        textwrap.dedent(
            f"""\
            At least one dependency not found: {str(_module_not_found_error)!r}
            It is possible that braintrust was installed without the CLI dependencies. Run:

              pip install 'braintrust[cli]'

            to install braintrust with the CLI dependencies (make sure to quote 'braintrust[cli]')."""
        )
    )


def main(args=None):
    """The main routine."""
    if args is None:
        args = sys.argv[1:]

    parent_parser = argparse.ArgumentParser(add_help=False)
    parent_parser.add_argument("--verbose", "-v", default=False, action="store_true")

    parser = argparse.ArgumentParser(description="braintrust is a cli tool to work with Braintrust.")
    subparsers = parser.add_subparsers(help="sub-command help", dest="subcommand", required=True)

    for module in [eval, install]:
        module.build_parser(subparsers, parent_parser)

    args = parser.parse_args(args=args)
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(format="%(asctime)s %(levelname)s [%(name)s]: %(message)s", level=level)

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
