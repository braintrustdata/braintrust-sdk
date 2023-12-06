import json
import os

import setuptools

dir_name = os.path.abspath(os.path.dirname(__file__))

version_contents = {}
with open(os.path.join(dir_name, "src", "braintrust_core", "version.py"), encoding="utf-8") as f:
    exec(f.read(), version_contents)

with open(os.path.join(dir_name, "README.md"), "r", encoding="utf-8") as f:
    long_description = f.read()

install_requires = []

extras_require = {}

setuptools.setup(
    name="braintrust_core",
    version=version_contents["VERSION"],
    author="Braintrust",
    author_email="info@braintrustdata.com",
    description="Shared core dependencies for Braintrust packages",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://www.braintrustdata.com",
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
