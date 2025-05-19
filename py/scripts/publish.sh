#!/bin/bash
# Script to publish the package to PyPI

# Check if PYPI_REPO environment variable is set
if [ -z "$PYPI_REPO" ]; then
    echo "Error: PYPI_REPO environment variable must be set"
    exit 1
fi

# Validate PYPI_REPO is either pypi or testpypi
if [ "$PYPI_REPO" != "pypi" ] && [ "$PYPI_REPO" != "testpypi" ]; then
    echo "Error: PYPI_REPO must be either 'pypi' or 'testpypi'"
    exit 1
fi

VERSION=$(bash scripts/get_version.sh)

if [ -z "$VERSION" ]; then
    echo "Error: Could not determine version"
    exit 1
fi

echo "Publishing version $VERSION to $PYPI_REPO"

# Upload to the specified repository (either pypi or testpypi)
twine upload --repository "$PYPI_REPO" dist/*"$VERSION"*
