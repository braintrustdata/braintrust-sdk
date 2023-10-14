# Sets the language we are generating code in, which other parts of the code can
# read and alter their behavior from.
LANG = ""


def set_lang(lang):
    global LANG
    LANG = lang


def get_lang():
    return LANG
