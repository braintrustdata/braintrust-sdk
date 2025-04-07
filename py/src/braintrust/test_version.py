from braintrust import version


def test_version():
    # Not the most interesting test, but it's a quick sanity check
    # that the templating during the build process works.
    assert version.VERSION
    assert version.GIT_COMMIT
