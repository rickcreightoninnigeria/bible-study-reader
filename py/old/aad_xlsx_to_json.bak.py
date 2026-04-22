import json
import pandas as pd
import re
import os

# Settings
INPUT_XLSX = '/home/rick/Downloads/aad_translate.xlsx'
MAP_FILE = 'aad_map.json'
ORIGINAL_JSON = '../app/js/locales/en/appAboutData_en.json'
OUTPUT_JSON = 'appAboutData_translated.json'

def unprotect(text):
    if pd.isna(text): return ""
    text = str(text)
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
    if not os.path.exists(INPUT_XLSX) or not os.path.exists(MAP_FILE):
        print(f"Error: Missing {INPUT_XLSX} or {MAP_FILE}")
        return

    # Load English source
    with open(ORIGINAL_JSON, 'r', encoding='utf-8') as f:
        final_data = json.load(f)

    # Load Excel - header=0 means the first row is the header
    df = pd.read_excel(INPUT_XLSX)
    
    # Use iloc to get the second column (index 1) regardless of its name
    translated_texts = df.iloc[:, 1].apply(unprotect).tolist()

    with open(MAP_FILE, 'r', encoding='utf-8') as f:
        mapping = json.load(f)

    for i, entry in enumerate(mapping):
        if i < len(translated_texts):
            set_by_path(final_data, entry['Path'], translated_texts[i])

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, indent=2, ensure_ascii=False)

    print(f"Success! Created {OUTPUT_JSON}")

if __name__ == "__main__":
    run()
