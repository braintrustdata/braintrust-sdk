"""
Define our tests to run against different combinations of
Python & library versions.
"""

import glob

import nox

LATEST = "__latest__"
SRC = "src/braintrust"
DIST = "dist"

SILENT_INSTALLS = True

ERROR_CODES = tuple(range(1, 256))

# The source of the braintrust package. We can test it against source code
# or a built wheel. Run `nox -k code` for your normal dev flow.
CODE = "code"
WHEEL = "wheel"
BT_SOURCES = (CODE, WHEEL)

# List your package here if it's not guaranteed to be installed. We'll (try to)
# validate things work with or without them.
VENDOR_PACKAGES = (
    "anthropic",
    "openai",
    "pydantic_ai",
    "autoevals",
    "braintrust_core",
)

# Test matrix
ANTHROPIC_VERSIONS = (LATEST, "0.50.0", "0.49.0", "0.48.0")
OPENAI_VERSIONS = (LATEST, "1.77.0", "1.71")
PYDANTIC_AI_VERSIONS = (LATEST, "0.1.9")
AUTOEVALS_VERSIONS = (LATEST, "0.0.129")


@nox.session()
@nox.parametrize("source", BT_SOURCES)
def test_core(session, source):
    """Test the core library with no optional dependencies installed."""
    _install_test_deps(session, source)

    if source == WHEEL:
        # sanity check we have installed from the wheel.
        lines = [
            "import sys, braintrust as b",
            "sys.exit(0 if 'site-packages' in b.__file__ else 1)",
        ]
        session.run("python", "-c", ";".join(lines), silent=True)

    # verify we haven't installed our 3p deps.
    for p in VENDOR_PACKAGES:
        session.run("python", "-c", f"import {p}", success_codes=ERROR_CODES, silent=True)
    session.run("python", "-c", "import braintrust")
    _run_common_tests(session)


@nox.session()
@nox.parametrize("pydantic_ai_version", PYDANTIC_AI_VERSIONS)
@nox.parametrize("source", BT_SOURCES)
def test_with_pydantic_ai(session, pydantic_ai_version, source):
    _install_test_deps(session, source)
    _install(session, "pydantic_ai", pydantic_ai_version)
    session.run("pytest", f"{SRC}/wrappers/test_pydantic_ai.py")
    _run_common_tests(session)


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
@nox.parametrize("source", BT_SOURCES)
def test_with_anthropic(session, version, source):
    _install_test_deps(session, source)
    _install(session, "anthropic", version)
    session.run("pytest", f"{SRC}/wrappers/test_anthropic.py")
    _run_common_tests(session)


@nox.session()
@nox.parametrize("version", OPENAI_VERSIONS)
@nox.parametrize("source", BT_SOURCES)
def test_with_openai(session, version, source):
    _install_test_deps(session, source)
    _install(session, "openai", version)
    session.run("pytest", f"{SRC}/wrappers/test_openai.py")
    _run_common_tests(session)


@nox.session()
@nox.parametrize("version", AUTOEVALS_VERSIONS)
@nox.parametrize("source", BT_SOURCES)
def test_with_autoevals(session, version, source):
    # Run all of our core tests with autoevals installed. Some tests
    # specifically validate scores from autoevals work properly, so
    # we need some tests with it installed.
    _install_test_deps(session, source)
    _install(session, "autoevals", version)
    _run_common_tests(session)


@nox.session()
@nox.parametrize("source", BT_SOURCES)
def test_with_braintrust_core(session, source):
    # Some tests do specific things if braintrust_core is installed, so run our
    # common tests with it installed. Testing the latest (aka the last ever version)
    # is enough.
    _install_test_deps(session, source)
    _install(session, "braintrust_core")
    _run_common_tests(session)


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


def _run_common_tests(session):
    """Run all the tests that don't require any special dependencies."""
    session.run("pytest", SRC, f"--ignore={SRC}/wrappers")


def _install(session, package, version=LATEST):
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.run("pip", "install", cmd, silent=SILENT_INSTALLS)
