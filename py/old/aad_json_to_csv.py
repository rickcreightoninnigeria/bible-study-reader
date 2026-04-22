import json
import csv
import os
import re

# Settings
INPUT_PATH = './en/appAboutData_en.json'
OUTPUT_CSV = 'aad_to_translate.csv'
MAP_FILE = 'aad_map.json'

# Fields to translate
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
                    extracted.append({'path': new_path, 'text': protect_placeholders(value)})
                elif isinstance(value, list):
                    for i, item in enumerate(value):
                        if isinstance(item, str):
                            extracted.append({'path': f"{new_path}[{i}]", 'text': protect_placeholders(item)})
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
    
    # Save Map
    with open(MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(strings, f, indent=2)

    # Save CSV
    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Path', 'Text'])
        for s in strings:
            writer.writerow([s['path'], s['text']])

    print(f"Extracted {len(strings)} strings to {OUTPUT_CSV}")

if __name__ == "__main__":
    run()
