import argparse
import textwrap

_module_not_found_error = None
try:
    from . import api, logs, redshift
except ModuleNotFoundError as e:
    _module_not_found_error = e


def fail_with_module_not_found_error(*args, **kwargs):
    raise ModuleNotFoundError(
        textwrap.dedent(
            f"""\
            At least one dependency not found: {str(_module_not_found_error)!r}
            It is possible that braintrust was installed without the CLI dependencies. Run:

              pip install 'braintrust[cli]'

            to install braintrust with the CLI dependencies (make sure to quote 'braintrust[cli]')."""
        )
    )


def build_parser(subparsers, parent_parser):
    install_parser = subparsers.add_parser(
        "install",
        help="Tools to setup and verify Braintrust's installation in your environment.",
        parents=[parent_parser],
    )
    if _module_not_found_error:
        install_parser.add_argument("args", nargs=argparse.REMAINDER)
        install_parser.set_defaults(func=fail_with_module_not_found_error)
    else:
        install_subparsers = install_parser.add_subparsers(dest="install_subcommand", required=True)

        for module in [api, logs, redshift]:
            module.build_parser(install_subparsers, parents=[parent_parser])
