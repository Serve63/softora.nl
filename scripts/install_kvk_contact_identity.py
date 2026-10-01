"""Recognize equivalent rejected phone numbers; preserve every evidence gate."""
import argparse
from pathlib import Path
from install_kvk_api_validation import install

EDITS = (
    ('        return {re.sub(r"\\D+", "", item["value"]) for item in rejections[field]}\n',
     '        from kvk_api_validation import phone_identity\n'
     '        return {phone_identity(item["value"]) for item in rejections[field]}\n'),
    ('            if digits in rejected_phones:\n',
     '            from kvk_api_validation import phone_identity\n'
     '            if phone_identity(hit) in rejected_phones:\n'),
    ('    # Social profile IDs, KVK slugs and encoded query parameters are not phone\n',
     '    # Belgian enterprise/VAT identifiers are not Belgian or Dutch contacts.\n'
     '    text = re.sub(r"\\bBE\\d{10}\\b", " ", text, flags=re.IGNORECASE)\n'
     '    # Social profile IDs, KVK slugs and encoded query parameters are not phone\n'),
)


def patched_source(source):
    installed = [new in source for _, new in EDITS]
    if all(installed):
        return source
    if any(installed):
        raise ValueError('Onvolledige telefooninstallatie; inspecteer eerst')
    for old, new in EDITS:
        if source.count(old) != 1:
            raise ValueError('Canonieke bron gewijzigd; geen installatie uitgevoerd')
        source = source.replace(old, new, 1)
    compile(source, 'contact_research.py', 'exec')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    module = args.root / 'scripts/kvk_api_validation.py'
    if module.read_bytes() != Path(__file__).with_name(module.name).read_bytes():
        raise ValueError('Installeer eerst de bijbehorende API-validatiemodule')
    target = args.root / 'scripts/contact_research.py'
    before = target.read_text()
    install(target, before, patched_source(before), args.root)
    print('Telefoonidentiteit: klaar')


if __name__ == '__main__':
    main()
