"""
Define our tests to run against different combinations of
Python & library versions.
"""


import nox

LATEST = "__latest__"
SRC = "src/braintrust"


ANTHROPIC_VERSIONS = ("0.48.0", "0.49.0", LATEST)


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
def test_anthropic(session, version):
    """Run pytest against a specific version of the anthropic SDK."""

    _install(session, "anthropic", version)

    # Run your tests
    session.run("pytest", f"{SRC}/wrappers/test_anthropic.py", external=True)


def _install(session, package, version=LATEST):
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.run("pip", "install", cmd)
