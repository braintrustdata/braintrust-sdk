"""
Define our tests to run against different combinations of
Python & library versions.
"""

import glob

import nox

LATEST = "__latest__"
SRC = "src/braintrust"
DIST = "dist"


ERROR_CODES = tuple(range(1, 256))

# The source of the braintrust package. We can test it against source code
# or a built wheel. Run `nox -k code` for your normal dev flow.
CODE = "code"
WHEEL = "wheel"
BT_SOURCES = (CODE, WHEEL)

# List your package here if it's not guaranteed to be installed. We'll (try to)
# validate things work with or without them.
VENDOR_PACKAGES = ("anthropic", "openai")

# Test matrix
ANTHROPIC_VERSIONS = (LATEST, "0.49.0", "0.48.0")
OPENAI_VERSIONS = (LATEST, "1.71")


@nox.session()
@nox.parametrize("source", BT_SOURCES)
def test_no_deps(session, source):
    """Ensure that with no dependencies, we can still import and use the
    library.
    """
    _install_test_deps(session, source)

    if source == WHEEL:
        # sanity check we have installed from the wheel.
        lines = [
            "import sys, braintrust as b",
            "sys.exit(0 if 'site-packages' in b.__file__ else 1)",
        ]
        session.run("python", "-c", ";".join(lines))

    # verify we haven't installed our 3p deps.
    for p in VENDOR_PACKAGES:
        session.run("python", "-c", f"import {p}", success_codes=ERROR_CODES)

    session.run("python", "-c", "import braintrust")
    session.run("pytest", SRC, f"--ignore={SRC}/wrappers")


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
@nox.parametrize("source", BT_SOURCES)
def test_anthropic(session, source, version):
    _install_test_deps(session, source)
    _install(session, "anthropic", version)
    session.run("pytest", f"{SRC}/wrappers/test_anthropic.py")


@nox.session()
@nox.parametrize("version", OPENAI_VERSIONS)
@nox.parametrize("source", BT_SOURCES)
def test_openai(session, version):
    _install_test_deps(session, source)
    _install(session, "openai", version)
    session.run("pytest", f"{SRC}/wrappers/test_openai.py")


def _install_test_deps(session, source):
    session.install("pytest")
    session.install("pytest-asyncio")

    if source == CODE:
        session.install("-e", ".[test]")
    elif source == WHEEL:
        wheel_path = _get_braintrust_wheel()
        session.install(wheel_path)
    else:
        raise Exception(f"Invalid source: {source}")


def _get_braintrust_wheel():
    path = "dist/braintrust-*.whl"
    wheels = glob.glob(path)
    if len(wheels) != 1:
        msg = f"There should be one wheel in {path}. Got {len(wheels)}"
        raise Exception(msg)
    return wheels[0]


def _install(session, package, version=LATEST):
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.run("pip", "install", cmd)
