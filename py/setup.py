import os

import setuptools

dir_name = os.path.abspath(os.path.dirname(__file__))

version_contents = {}
with open(os.path.join(dir_name, "src", "braintrust", "version.py"), encoding="utf-8") as f:
    exec(f.read(), version_contents)

with open(os.path.join(dir_name, "README.md"), "r", encoding="utf-8") as f:
    long_description = f.read()

install_requires = ["GitPython", "requests", "autoevals>=0.0.26", "tqdm"]

extras_require = {
    "cli": ["boto3", "psycopg2-binary"],
    "dev": [
        "black",
        "build",
        "flake8",
        "flake8-isort",
        "IPython",
        "isort==5.10.1",
        "pre-commit",
        "pytest",
        "twine",
    ],
    "doc": ["pydoc-markdown"],
}

extras_require["all"] = sorted({package for packages in extras_require.values() for package in packages})

setuptools.setup(
    name="braintrust",
    version=version_contents["VERSION"],
    author="Braintrust",
    author_email="info@braintrustdata.com",
    description="SDK for integrating Braintrust",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://www.braintrustdata.com",
    # project_urls={
    #    "Bug Tracker": "https://github.com/TODO/issues",
    # },
    classifiers=[
        "Programming Language :: Python :: 3",
        "Operating System :: OS Independent",
    ],
    package_dir={"": "src"},
    packages=setuptools.find_packages(where="src"),
    python_requires=">=3.7.0",
    entry_points={"console_scripts": ["braintrust = braintrust.cli.__main__:main"]},
    install_requires=install_requires,
    extras_require=extras_require,
)
