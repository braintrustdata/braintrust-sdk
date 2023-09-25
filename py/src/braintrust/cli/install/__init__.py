from . import api, redshift


def build_parser(subparsers, parent_parser):
    install_parser = subparsers.add_parser(
        "install",
        help="Tools to setup and verify Braintrust's installation in your environment.",
        parents=[parent_parser],
    )
    install_subparsers = install_parser.add_subparsers(dest="install_subcommand", required=True)

    for module in [api, redshift]:
        module.build_parser(install_subparsers, parents=[parent_parser])
