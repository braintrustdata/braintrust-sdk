"""
Define our tests to run against different combinations of
Python & library versions.
"""

import nox

LATEST = "__latest__"

nox.options.default_venv_backend = "uv"


LANGGRAPH_VERSIONS = ("0.3.21", "0.3.22", LATEST)


@nox.session()
@nox.parametrize("langgraph_version", LANGGRAPH_VERSIONS)
def test_langchain(session, langgraph_version):
    session.install("-e", ".[test]")
    _install(session, "langgraph", langgraph_version)
    session.run("pytest")


def _install(session, package, version=LATEST):
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.install(cmd)
