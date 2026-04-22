import json
import csv
import re
import os

# Settings
INPUT_CSV = 'aad_translated.csv'
MAP_FILE = 'aad_map.json'
ORIGINAL_JSON = './en/appAboutData_en.json'
OUTPUT_JSON = 'appAboutData_translated.json'

def unprotect(text):
    if not text: return ""
    text = re.sub(r'<span class="notranslate">(.*?)</span>', r'\1', text)
    return text.replace('<span class = "notranslate">', '').replace('</span>', '')

def set_by_path(data, path, value):
    parts = path.replace('[', '.[').split('.')
    current = data
    for part in parts[:-1]:
        if part.startswith('['):
            current = current[int(part[1:-1])]
        else:
            current = current[part]
    last = parts[-1]
    if last.startswith('['):
        current[int(last[1:-1])] = value
    else:
        current[last] = value

def run():
    if not os.path.exists(INPUT_CSV) or not os.path.exists(MAP_FILE):
        print("Error: Missing translated CSV or Map file.")
        return

    with open(ORIGINAL_JSON, 'r', encoding='utf-8') as f:
        final_data = json.load(f)

    translated_texts = []
    with open(INPUT_CSV, 'r', encoding='utf-8') as f:
        content = f.read()
        dialect = csv.Sniffer().sniff(content[:2048])
        f.seek(0)
        reader = csv.reader(f, dialect)
        next(reader) # Skip headers regardless of language
        for row in reader:
            if len(row) >= 2:
                translated_texts.append(unprotect(row[1]))

    with open(MAP_FILE, 'r', encoding='utf-8') as f:
        mapping = json.load(f)

    for i, entry in enumerate(mapping):
        if i < len(translated_texts):
            set_by_path(final_data, entry['path'], translated_texts[i])

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, indent=2, ensure_ascii=False)

    print(f"Success! Created {OUTPUT_JSON}")

if __name__ == "__main__":
    run()