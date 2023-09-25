#!/bin/bash

SRC_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

ps1_old="$PS1"
source $SRC_ROOT/venv/bin/activate
export BRAINTRUST_DEV=1
export PS1="(bt) $ps1_old"
