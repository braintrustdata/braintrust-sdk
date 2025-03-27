"""
Define our tests to run against different combinations of
Python & library versions.
"""


import nox

LATEST = "__latest__"
SRC = "src/braintrust"


ANTHROPIC_VERSIONS = ("0.48.0", "0.49.0", LATEST)


@nox.session()
def test_no_deps(session):
    """Ensure that with no dependencies, we can still import and use the
    library.
    """
    session.install("pytest")
    session.install("-e", ".[test]")

    # make sure we can import the library
    session.run("python", "-c", "import braintrust")

    # run tests that don't require any dependencies
    session.run("pytest", SRC, f"--ignore={SRC}/wrappers")


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
def test_anthropic(session, version):
    """Run pytest against a specific version of
    the anthropic SDK."""

    session.install("pytest")
    session.install("-e", ".[test]")

    _install(session, "anthropic", version)

    # Run your tests
    session.run("pytest", f"{SRC}/wrappers/test_anthropic.py")


def _install(session, package, version=LATEST):
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.run("pip", "install", cmd)
