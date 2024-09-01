TOP_BITS = 0x0DE1 << 48

MOD = 2**64
COPRIME = 205891132094649
COPRIME_INVERSE = 1522336535492693385


def modular_multiply(value: int, prime: int):
    return (value * prime) % MOD


# value : int | str
# Cannot use a | because of python 3.8
def prettify_xact(value) -> str:
    encoded = modular_multiply(int(value), COPRIME)
    return hex(encoded)[2:].rjust(16, "0")


def load_pretty_xact(encoded_hex: str) -> str:
    value = int(encoded_hex, 16)
    multiplied_inverse = modular_multiply(value, COPRIME_INVERSE)
    with_top_bits = TOP_BITS | multiplied_inverse
    return str(with_top_bits)
