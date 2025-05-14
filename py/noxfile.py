"""
Nox scripts the environment our tests run in and it used to verify our library
works with and without different dependencies. A few commands to check out:

    nox                        Run all sessions.
    nox -l                     List all sessions.
    nox -s <session>           Run a specific session.
    nox ... -- --wheel         Run tests against the wheel in dist.
    nox -h                     Get help.
"""

import glob

import nox

LATEST = "__latest__"
SRC = "src/braintrust"
DIST = "dist"

SILENT_INSTALLS = True

ERROR_CODES = tuple(range(1, 256))

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
def test_core(session):
    _install_test_deps(session)
    # verify we haven't installed our 3p deps.
    for p in VENDOR_PACKAGES:
        session.run("python", "-c", f"import {p}", success_codes=ERROR_CODES, silent=True)
    _run_common_tests(session)


@nox.session()
@nox.parametrize("pydantic_ai_version", PYDANTIC_AI_VERSIONS)
def test_with_pydantic_ai(session, pydantic_ai_version):
    _install_test_deps(session)
    _install(session, "pydantic_ai", pydantic_ai_version)
    session.run("pytest", f"{SRC}/wrappers/test_pydantic_ai.py")
    _run_common_tests(session)


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
def test_with_anthropic(session, version):
    _install_test_deps(session)
    _install(session, "anthropic", version)
    session.run("pytest", f"{SRC}/wrappers/test_anthropic.py")
    _run_common_tests(session)


@nox.session()
@nox.parametrize("version", OPENAI_VERSIONS)
def test_with_openai(session, version):
    _install_test_deps(session)
    _install(session, "openai", version)
    session.run("pytest", f"{SRC}/wrappers/test_openai.py")
    _run_common_tests(session)


@nox.session()
@nox.parametrize("version", AUTOEVALS_VERSIONS)
def test_with_autoevals(session, version):
    # Run all of our core tests with autoevals installed. Some tests
    # specifically validate scores from autoevals work properly, so
    # we need some tests with it installed.
    _install_test_deps(session)
    _install(session, "autoevals", version)
    _run_common_tests(session)


@nox.session()
def test_with_braintrust_core(session):
    # Some tests do specific things if braintrust_core is installed, so run our
    # common tests with it installed. Testing the latest (aka the last ever version)
    # is enough.
    _install_test_deps(session)
    _install(session, "braintrust_core")
    _run_common_tests(session)


def _install_test_deps(session):
    # verify braintrust isn't installed yet
    session.run("python", "-c", "import braintrust", success_codes=ERROR_CODES, silent=True)

    install_wheel = "--wheel" in session.posargs

    session.install("pytest")
    session.install("pytest-asyncio")
    if install_wheel:
        wheel_path = _get_braintrust_wheel()
        session.install(wheel_path)
    else:
        session.install("-e", ".[test]")

    # Sanity check we have installed braintrust (and that it is from a wheel if needed)
    session.run("python", "-c", "import braintrust")
    if install_wheel:
        lines = [
            "import sys, braintrust as b",
            "sys.exit(0 if 'site-packages' in b.__file__ else 1)",
        ]
        session.run("python", "-c", ";".join(lines), silent=True)


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
