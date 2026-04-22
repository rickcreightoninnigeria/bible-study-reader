import json
import pandas as pd
import os
import re

# Settings
INPUT_PATH = '../app/js/locales/en/appAboutData_en.json'
OUTPUT_XLSX = 'aad_translate.xlsx'
MAP_FILE = 'aad_map.json'

WHITELIST = {'appTitle', 'appDescription', 'sampleTitle', 'sampleSubtitle', 
             'sampleShortTitle', 'sampleDescription', 'name', 'freedoms', 
             'conditions', 'notices'}

def protect_placeholders(text):
    return re.sub(r'(\{[a-zA-Z0-9_]+\})', r'<span class="notranslate">\1</span>', text)

def extract_strings(data, path=""):
    extracted = []
    if isinstance(data, dict):
        for key, value in data.items():
            new_path = f"{path}.{key}" if path else key
            if key in WHITELIST:
                if isinstance(value, str):
                    extracted.append({'Path': new_path, 'Text': protect_placeholders(value)})
                elif isinstance(value, list):
                    for i, item in enumerate(value):
                        if isinstance(item, str):
                            extracted.append({'Path': f"{new_path}[{i}]", 'Text': protect_placeholders(item)})
            else:
                extracted.extend(extract_strings(value, new_path))
    return extracted

def run():
    if not os.path.exists(INPUT_PATH):
        print(f"Error: {INPUT_PATH} not found.")
        return

    with open(INPUT_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    strings = extract_strings(data)
    
    # Save Map (JSON)
    with open(MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(strings, f, indent=2)

    # Save XLSX using Pandas
    df = pd.DataFrame(strings)
    df.to_excel(OUTPUT_XLSX, index=False)

    print(f"Success! {len(strings)} strings exported to {OUTPUT_XLSX}")

if __name__ == "__main__":
    run()