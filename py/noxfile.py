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
    _install_deps(session)
    session.run("python", "-c", "import braintrust")
    session.run("pytest", SRC, f"--ignore={SRC}/wrappers")


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
def test_anthropic(session, version):
    _install_deps(session)
    _install(session, "anthropic", version)
    session.run("pytest", f"{SRC}/wrappers/test_anthropic.py")


def _install_deps(session):
    # Install our test dependencies in this session's venv.
    session.install("pytest")
    session.install("-e", ".[test]")


def _install(session, package, version=LATEST):
    # install into this session's venv
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.run("pip", "install", cmd)
