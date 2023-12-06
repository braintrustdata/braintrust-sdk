import json
import os

import setuptools

# Note: instead of using the directory name of the script, we use the current
# working directory, because the script may be in a different location during
# the packaging process. This means we assume the packaging is run in this
# directory (sdk/core/py).
dir_name = os.environ["PWD"]

version = None
description = None
url = None
with open(os.path.join(dir_name, "..", "js", "package.json"), "r", encoding="utf-8") as f:
    contents = json.load(f)
    version = contents["version"]
    description = contents["description"]
    url = contents["homepage"]

with open(os.path.join(dir_name, "..", "README.md"), "r", encoding="utf-8") as f:
    long_description = f.read()

install_requires = []

extras_require = {}

setuptools.setup(
    name="braintrust_core",
    version=version,
    author="Braintrust",
    author_email="info@braintrustdata.com",
    description=description,
    long_description=long_description,
    long_description_content_type="text/markdown",
    url=url,
    classifiers=[
        "Programming Language :: Python :: 3",
        "Operating System :: OS Independent",
    ],
    package_dir={"": "src"},
    packages=setuptools.find_packages(where="src"),
    python_requires=">=3.8.0",
    install_requires=install_requires,
    extras_require=extras_require,
)
